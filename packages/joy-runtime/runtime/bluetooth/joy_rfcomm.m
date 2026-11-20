#import <Foundation/Foundation.h>
#import <IOBluetooth/IOBluetooth.h>
#include <stdatomic.h>
#include <stdbool.h>
#include <stdint.h>
#include <limits.h>
#include <math.h>

// No hardware API is called in either self-test mode.
static const NSUInteger kLimit=1024*1024;
static BOOL ipcTest=NO,hardwareAllowed=NO,ownedBaseband=NO;
static atomic_bool workerDone=ATOMIC_VAR_INIT(false);
static NSError *Err(NSString *text){return [NSError errorWithDomain:@"joy_rfcomm" code:1 userInfo:@{NSLocalizedDescriptionKey:text}];}
static NSArray<NSNumber *> *Chunks(NSUInteger count,NSUInteger mtu){
    if(!mtu||mtu>UINT16_MAX)return nil;
    NSMutableArray *parts=[NSMutableArray array];
    while(count){NSUInteger n=MIN(count,mtu);[parts addObject:@(n)];count-=n;}
    return parts;
}
@interface StreamBuffer:NSObject
@property(nonatomic,strong) NSMutableData *data;
@property(nonatomic,strong) NSCondition *condition;
@property(nonatomic) BOOL closed,overflow;
- (BOOL)append:(NSData *)data;
- (NSData *)take:(NSUInteger)count timeout:(NSTimeInterval)timeout error:(NSError **)error;
- (void)finish;
@end
@implementation StreamBuffer
- (instancetype)init{if((self=[super init])){_data=[NSMutableData data];_condition=[NSCondition new];}return self;}
- (BOOL)append:(NSData *)data{
    [_condition lock];BOOL ok=!_closed;
    if(ok&&data.length>kLimit-_data.length){_overflow=YES;_closed=YES;[_data setLength:0];ok=NO;}
    if(ok)[_data appendData:data];[_condition broadcast];[_condition unlock];return ok;
}
- (void)finish{[_condition lock];_closed=YES;[_condition broadcast];[_condition unlock];}
- (NSData *)take:(NSUInteger)count timeout:(NSTimeInterval)timeout error:(NSError **)error{
    [_condition lock];NSDate *deadline=[NSDate dateWithTimeIntervalSinceNow:timeout];
    while(!_data.length&&!_closed){if(![_condition waitUntilDate:deadline])break;}
    if(_overflow){if(error)*error=Err(@"receive queue overflow");[_condition unlock];return nil;}
    if(_data.length){NSUInteger n=MIN(count,_data.length);NSData *part=[_data subdataWithRange:NSMakeRange(0,n)];[_data replaceBytesInRange:NSMakeRange(0,n) withBytes:NULL length:0];[_condition unlock];return part;}
    if(_closed){if(error)*error=Err(@"channel closed");[_condition unlock];return nil;}
    [_condition unlock];return [NSData data];
}
@end
@interface RFCOMMDelegate:NSObject<IOBluetoothRFCOMMChannelDelegate>
@property(nonatomic,strong) StreamBuffer *buffer;
@end
@implementation RFCOMMDelegate
- (void)rfcommChannelData:(IOBluetoothRFCOMMChannel *)channel data:(void *)data length:(size_t)length{
    [_buffer append:[NSData dataWithBytes:data length:length]];
}
- (void)rfcommChannelClosed:(IOBluetoothRFCOMMChannel *)channel{[_buffer finish];}
@end
static IOBluetoothDevice *device;
static IOBluetoothRFCOMMChannel *channel;
static RFCOMMDelegate *delegateObject;
static StreamBuffer *testBuffer;
static void respond(NSDictionary *reply){
    NSData *data=[NSJSONSerialization dataWithJSONObject:reply options:0 error:NULL];
    if(data){fwrite(data.bytes,1,data.length,stdout);fputc('\n',stdout);fflush(stdout);}
}
static void fail(NSString *reason){respond(@{@"ok":@NO,@"error":reason?:@"operation failed"});}
static BOOL validTimeout(id value){return [value isKindOfClass:NSNumber.class]&&isfinite([value doubleValue])&&[value doubleValue]>=0&&[value doubleValue]<=120;}
static BOOL validCount(id value){return [value isKindOfClass:NSNumber.class]&&isfinite([value doubleValue])&&[value doubleValue]>=1&&[value doubleValue]<=kLimit&&floor([value doubleValue])==[value doubleValue];}
// Called only on main thread. Never disconnect an existing unowned baseband.
static void closeDevice(void){
    if(ipcTest||!hardwareAllowed){[testBuffer finish];return;}
    if(channel){[channel closeChannel];channel=nil;}
    [delegateObject.buffer finish];delegateObject=nil;
    if(ownedBaseband&&device)[device closeConnection];
    ownedBaseband=NO;device=nil;
}
// IOBluetooth callbacks must be able to reenter the main run loop. Executing
// synchronous SDK calls inside a main-dispatch block starves those callbacks.
static void onMain(dispatch_block_t block){
    if([NSThread isMainThread]){block();return;}
    dispatch_semaphore_t done=dispatch_semaphore_create(0);
    CFRunLoopPerformBlock(CFRunLoopGetMain(),kCFRunLoopDefaultMode,^{block();dispatch_semaphore_signal(done);});
    CFRunLoopWakeUp(CFRunLoopGetMain());dispatch_semaphore_wait(done,DISPATCH_TIME_FOREVER);
}
static void process(NSDictionary *request){
    id op=request[@"op"];
    if(![op isKindOfClass:NSString.class]){fail(@"invalid operation");return;}
    if(ipcTest&&([op isEqual:@"open"]||[op isEqual:@"write"])){fail(@"hardware disabled in IPC self-test");return;}
    if(ipcTest&&[op isEqual:@"ping"]){onMain(^{});respond(@{@"ok":@YES,@"pong":@YES});return;}
    if(ipcTest&&[op isEqual:@"inject"]){
        id value=request[@"data"];NSData *data=[value isKindOfClass:NSString.class]?[[NSData alloc]initWithBase64EncodedString:value options:0]:nil;
        if(!data||data.length>kLimit){fail(@"invalid test data");return;}
        __block BOOL ok=NO;onMain(^{ok=[testBuffer append:data];});
        if(ok)respond(@{@"ok":@YES});else fail(@"receive queue unavailable");return;
    }
    if([op isEqual:@"open"]){
        if(!hardwareAllowed){fail(@"hardware access denied");return;}
        id address=request[@"address"];
        if(![address isKindOfClass:NSString.class]||[address rangeOfString:@"^[0-9A-Fa-f]{2}([:-][0-9A-Fa-f]{2}){5}$" options:NSRegularExpressionSearch].location==NSNotFound){fail(@"invalid address");return;}
        __block NSString *reason=nil;
        onMain(^{
            if(device||channel){reason=@"connection already open";return;}
            device=[IOBluetoothDevice deviceWithAddressString:address];
            if(!device){reason=@"device unavailable";return;}
            if(!device.isConnected){
                if([device openConnection]!=kIOReturnSuccess){reason=@"baseband connection failed";closeDevice();return;}
                ownedBaseband=YES;
            }
            // Paired devices already have cached SDP records. Do not launch an
            // asynchronous SDP query here and race it with RFCOMM channel open.
            IOBluetoothSDPServiceRecord *service=[device getServiceRecordForUUID:[IOBluetoothSDPUUID uuid16:0x1101]];
            BluetoothRFCOMMChannelID channelID=0;
            if(!service||[service getRFCOMMChannelID:&channelID]!=kIOReturnSuccess||!channelID){reason=@"SPP service unavailable";closeDevice();return;}
            delegateObject=[RFCOMMDelegate new];delegateObject.buffer=[StreamBuffer new];
            IOBluetoothRFCOMMChannel *opened=nil;
            if([device openRFCOMMChannelSync:&opened withChannelID:channelID delegate:delegateObject]!=kIOReturnSuccess||!opened){reason=@"RFCOMM open failed";closeDevice();return;}
            channel=opened;
        });
        if(reason)fail(reason);else respond(@{@"ok":@YES});return;
    }
    if([op isEqual:@"read"]){
        id count=request[@"max_bytes"],timeout=request[@"timeout"];
        if(!validCount(count)||!validTimeout(timeout)||(!ipcTest&&!channel)){fail(@"invalid read or channel closed");return;}
        NSError *error=nil;StreamBuffer *buffer=ipcTest?testBuffer:delegateObject.buffer;
        NSData *data=[buffer take:[count unsignedIntegerValue] timeout:[timeout doubleValue] error:&error];
        if(!data)fail(error.localizedDescription);else respond(@{@"ok":@YES,@"data":[data base64EncodedStringWithOptions:0]});return;
    }
    if([op isEqual:@"write"]){
        if(!hardwareAllowed){fail(@"hardware access denied");return;}
        id value=request[@"data"],timeout=request[@"timeout"];
        NSData *data=[value isKindOfClass:NSString.class]?[[NSData alloc]initWithBase64EncodedString:value options:0]:nil;
        if(!channel||!data||data.length>kLimit||!validTimeout(timeout)){fail(@"invalid write or channel closed");return;}
        __block NSString *reason=nil;
        onMain(^{
            NSArray *parts=Chunks(data.length,[channel getMTU]);
            if(!parts){reason=@"invalid channel MTU";return;}
            NSDate *deadline=[NSDate dateWithTimeIntervalSinceNow:[timeout doubleValue]];NSUInteger offset=0;
            for(NSNumber *part in parts){
                if([deadline timeIntervalSinceNow]<=0){reason=@"write deadline exceeded";return;}
                UInt16 n=(UInt16)part.unsignedIntegerValue;
                // An in-flight SDK writeSync cannot be cancelled: host owns hard timeout.
                if([channel writeSync:(void *)((const uint8_t *)data.bytes+offset) length:n]!=kIOReturnSuccess){reason=@"RFCOMM write failed";return;}
                offset+=n;
            }
        });
        if(reason)fail(reason);else respond(@{@"ok":@YES,@"written":@(data.length)});return;
    }
    if([op isEqual:@"close"]){onMain(^{closeDevice();});respond(@{@"ok":@YES});return;}
    fail(@"unknown operation");
}
static void worker(void){
    char *line=calloc(kLimit+2,1);
    if(!line){fail(@"allocation failed");return;}
    while(fgets(line,(int)kLimit+2,stdin)){
        @autoreleasepool{
            size_t length=strlen(line);
            if(length>kLimit||!length||line[length-1]!='\n'){fail(@"oversized or unterminated request");break;}
            @try{
                id request=[NSJSONSerialization JSONObjectWithData:[NSData dataWithBytes:line length:length] options:NSJSONReadingFragmentsAllowed error:NULL];
                if([request isKindOfClass:NSDictionary.class])process(request);else fail(@"invalid JSON request");
            }@catch(NSException *exception){fail(@"request failed");}
        }
    }
    free(line);
}
static BOOL selfTest(void){
    StreamBuffer *buffer=[StreamBuffer new];NSError *error=nil;
    BOOL ok=[buffer append:[@"abcdef" dataUsingEncoding:NSUTF8StringEncoding]];
    ok=ok&&[[buffer take:2 timeout:0 error:&error] isEqual:[@"ab" dataUsingEncoding:NSUTF8StringEncoding]];
    ok=ok&&[[buffer take:8 timeout:0 error:&error] isEqual:[@"cdef" dataUsingEncoding:NSUTF8StringEncoding]];
    ok=ok&&[buffer take:1 timeout:0 error:&error].length==0&&!error;
    [buffer finish];ok=ok&&[buffer take:1 timeout:0 error:&error]==nil&&error!=nil;
    StreamBuffer *over=[StreamBuffer new];ok=ok&&[over append:[NSMutableData dataWithLength:kLimit]];
    ok=ok&&![over append:[NSData dataWithBytes:"x" length:1]];
    error=nil;ok=ok&&[over take:1 timeout:0 error:&error]==nil&&error!=nil;
    ok=ok&&[Chunks(11,4) isEqual:@[@4,@4,@3]]&&Chunks(1,0)==nil&&Chunks(1,UINT16_MAX+1U)==nil;
    NSDictionary *value=@{@"ok":@YES};NSData *json=[NSJSONSerialization dataWithJSONObject:value options:0 error:NULL];
    ok=ok&&[[NSJSONSerialization JSONObjectWithData:json options:0 error:NULL] isEqual:value];
    return ok;
}
int main(int argc,const char **argv){
    @autoreleasepool{
        BOOL basicTest=NO;
        if(argc==2&&!strcmp(argv[1],"--devices")){
            NSMutableArray *items=[NSMutableArray array];
            for(IOBluetoothDevice *known in [IOBluetoothDevice pairedDevices]){
                NSString *name=known.name?:@"";
                if([name rangeOfString:@"^(?:Cricut )?Joy(?:[- ]|$)" options:NSRegularExpressionSearch|NSCaseInsensitiveSearch].location==NSNotFound||[name localizedCaseInsensitiveContainsString:@"xtra"])continue;
                NSString *address=[known.addressString stringByReplacingOccurrencesOfString:@"-" withString:@":"];
                if(name.length>128||!address)continue;
                [items addObject:@{@"name":name,@"address":address,@"paired":@(known.isPaired),@"connected":@(known.isConnected)}];
            }
            respond(@{@"ok":@YES,@"devices":items});return 0;
        }
        for(int i=1;i<argc;i++){
            if(!strcmp(argv[i],"--allow-hardware"))hardwareAllowed=YES;
            else if(!strcmp(argv[i],"--self-test"))basicTest=YES;
            else if(!strcmp(argv[i],"--ipc-self-test"))ipcTest=YES;
            else{fail(@"unknown argument");return 2;}
        }
        if((basicTest||ipcTest)&&hardwareAllowed){fail(@"test mode cannot enable hardware");return 2;}
        if(basicTest){BOOL ok=selfTest();respond(@{@"ok":@(ok),@"self_test":@(ok)});return ok?0:1;}
        if(!hardwareAllowed&&!ipcTest){fail(@"hardware access requires --allow-hardware");return 2;}
        if(ipcTest)testBuffer=[StreamBuffer new];
        NSPort *keepAlive=[NSMachPort port];[[NSRunLoop mainRunLoop]addPort:keepAlive forMode:NSDefaultRunLoopMode];
        dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED,0),^{
            worker();dispatch_async(dispatch_get_main_queue(),^{closeDevice();atomic_store(&workerDone,true);CFRunLoopStop(CFRunLoopGetMain());});
        });
        while(!atomic_load(&workerDone))CFRunLoopRunInMode(kCFRunLoopDefaultMode,.25,false);
        [keepAlive invalidate];return 0;
    }
}

"""Explicit original-Joy persistent pressure-table read; never opens a session."""
import math
import time
from joy_pressure_table import pressure_table_request_bodies,decode_pressure_table,decode_pressure_entry
from joy_protocol import clear_frame

def capture_pressure_table(session,*,timeout=8):
    if type(timeout) not in (int,float) or not math.isfinite(timeout) or not 0<timeout<=16:raise ValueError('Calibration deadline must be within (0,16] seconds')
    result=getattr(session,'result',None)
    if getattr(session,'state',None)!='ready' or result is None or result.selector!=8.164000001 or result.used_fallback is not False:raise RuntimeError('An exact initialized original Joy is required')
    deadline=time.monotonic()+timeout
    def left():
        remaining=deadline-time.monotonic()
        if remaining<=0:raise TimeoutError('Calibration read deadline exceeded')
        return min(2,remaining)
    try:
        rows=[]
        for index,body in enumerate(pressure_table_request_bodies(),1):
            session.channel.send(clear_frame(body),encrypted=True,timeout=left())
            reply=session.channel.receive(left(),require_encrypted=True)
            if type(reply) is not bytes or len(reply)<2 or int.from_bytes(reply[:2],'big')!=len(reply)-2:raise ValueError('Invalid calibration framing')
            decode_pressure_entry(index,reply[2:])
            rows.append(reply[2:]);left()
        decode_pressure_table(rows)
        return {'firmwareSelector':result.selector,'pressureResponsesHex':[x.hex()for x in rows],
                'source':'device_pressure_table_read','physicalCalibrationVerified':False}
    except Exception as primary:
        try:session.close()
        except Exception as cleanup:raise primary from cleanup
        raise

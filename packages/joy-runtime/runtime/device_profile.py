import base64,json,math
from pathlib import Path
from materials import MaterialStore,_Record

def load_joy_profile(path=None):
    """Load only the versioned original-Joy compatibility pack; never a cache."""
    try:
        source=Path(path) if path is not None else Path(__file__).parent/'profiles/cricut-joy.json'
        with source.open('rb') as f:data=f.read(65537)
        if len(data)>65536:raise ValueError()
        p=json.loads(data)
        if (p['schemaVersion']!=1 or p['profileId']!='cricut-joy' or p['machine']!=12 or p['protocol']!='joy-v1' or p['transport']!='BluetoothSPP' or p['capabilities'].get('cuts') is not False):raise ValueError()
        values=p['initializationRecords']
        if not isinstance(values,list) or not 1<=len(values)<=32:raise ValueError()
        records=[]
        for r in values:
            if r['machineType']!=12:raise ValueError()
            lower,upper=r['lower'],r['upper']
            if any(type(x) not in (int,float) or not math.isfinite(x) for x in [lower,upper]) or not 0<=lower<upper:raise ValueError()
            if any(type(r[k]) is not bool for k in ['odd','reverse','mix']):raise ValueError()
            raw=base64.b64decode(r['rawBase64'],validate=True)
            if len(raw)!=64 or base64.b64encode(raw).decode()!=r['rawBase64']:raise ValueError()
            if any(lower<old.upper and upper>old.lower for old in records):raise ValueError()
            records.append(_Record(12,lower,upper,r['odd'],r['reverse'],r['mix'],raw))
        return MaterialStore(records)
    except (OSError,ValueError,TypeError,KeyError,UnicodeError):raise ValueError('Bundled Joy profile is unavailable or invalid') from None

"""Fixed mat-only requests, no paths, job data, pressure or cutter actions.
Source: ZorroLoadMatCommand 1000602fc / factory 10006021c / ILoadMat
callers 1000a4c6c and 1000a55dc. Joy uses its own verified outer framing.
Load request/0x14 ACK verified on Joy-C3D0; ACK is not a mat-presence sensor.
"""
from joy_protocol import clear_frame

def mat_request(action):
 if action not in ('load','unload'):raise ValueError('Only load/unload mat actions are supported')
 return clear_frame(bytes([0x84,1 if action=='load' else 3,1,0]))

def control_mat(session,action,*,motion_approved=False,timeout=8):
 if motion_approved is not True:raise PermissionError('Explicit roller-motion approval required')
 if session.state!='ready':raise RuntimeError('Connect the Joy before controlling its mat')
 packet=mat_request(action)
 try:
  deadline=session._deadline(timeout)
  session.channel.send(packet,encrypted=True,timeout=session._left(deadline))
  reply=session.channel.receive(session._left(deadline),require_encrypted=True)[2:]
  rejected=len(reply)>=3 and reply[:2]==bytes([1,0x84])
  if not rejected and reply!=bytes.fromhex('14000000'):raise ValueError('Unexpected mat acknowledgement; do not retry automatically')
  status=session.query_status(timeout=session._left(deadline))
  return {'action':action,'requestAcknowledged':not rejected,'matPresenceVerified':False,'status':status,**({'responseCode':reply[2]} if rejected else {})}
 except Exception:
  session.close();raise

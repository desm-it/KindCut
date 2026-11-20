"""Source-derived M0,0 representation; application post-tool finishing policy.

Native deb90/d7d14/d6a44 emits a move-kind2 and its identical terminal record.
This encodes non-drawing intent, not a physical Z-height/clearance guarantee.
"""
ORIGIN_RETURN_RECORDS=(bytes.fromhex('020000000000000000'),)*2
ORIGIN_RETURN_FRAME='kindcut_canvas_pt72_v1'

"""Bounded, explicitly invoked Joy initialization over an already-open channel.

No automatic discovery/open/cache read, motion, retries or reinitialization.
Reset->firmware->key-init order is source-grounded; fail-closed encrypted status
confirmation and a total deadline are engineering policies, not hardware proof.
"""
from dataclasses import dataclass
import math
import os
import time
from joy_protocol import request,parse_firmware,parse_status
from materials import selector_version


@dataclass(frozen=True)
class InitializationResult:
    firmware:dict
    status:dict
    selector:float
    material_record_index:int
    used_fallback:bool


class JoyInitializer:
    def __init__(self,channel,store,*,rng=None,include_status_extra=False):
        self.channel=channel
        self.store=store
        self._rng=os.urandom if rng is None else rng
        self._include_extra=include_status_extra
        self.state='new'
        self.result=None

    @staticmethod
    def _deadline(timeout):
        timeout=float(timeout)
        if not math.isfinite(timeout) or not 0<timeout<=120:
            raise ValueError('Initialization timeout must be within (0,120] seconds')
        return time.monotonic()+timeout

    @staticmethod
    def _left(deadline):
        left=deadline-time.monotonic()
        if left<=0:raise TimeoutError('Initialization deadline exceeded')
        return left

    def _clear_exchange(self,packet,deadline):
        self.channel.send(packet,timeout=self._left(deadline))
        return self.channel.receive(self._left(deadline),require_encrypted=False)

    def _status(self,deadline):
        self.channel.send(request('status'),encrypted=True,timeout=self._left(deadline))
        reply=self.channel.receive(self._left(deadline),require_encrypted=True)
        return parse_status(reply[2:],include_extra=self._include_extra)

    def _discard(self):
        self.state='failed'
        self.result=None
        self.channel.close()

    def initialize(self,*,allow_crypto_reset=False,timeout=2,identifier=b''):
        if allow_crypto_reset is not True:
            raise PermissionError('Initialization changes device AES state; explicit approval required')
        if self.state!='new':raise RuntimeError('Create a new channel/session before reinitializing')
        deadline=self._deadline(timeout)
        try:
            self.channel.crypto.reset()
            self.state='resetting'
            reset_reply=self._clear_exchange(request('reset',self._rng(3)),deadline)
            # The native ResetAES parser is a no-op (035d58). Require a nonempty
            # clear reply conservatively, but do NOT invent an ACK opcode/meaning.
            if len(reset_reply)<3:raise ValueError('Missing opaque reset response')
            self.state='firmware'
            firmware_reply=self._clear_exchange(request('firmware'),deadline)
            firmware=parse_firmware(firmware_reply[2:])
            version=selector_version(firmware['component_i32'],firmware['component_u32'])
            selected=self.store.select(12,version,identifier)
            self.state='key-exchange'
            offset=self._rng(1)
            if len(offset)!=1:raise ValueError('Entropy source did not return one byte')
            packet=request('bootstrap',self._rng(51),offset[0])
            reply=self._clear_exchange(packet,deadline)
            self.channel.crypto.activate(reply,selected.material)
            self.state='verifying'
            status=self._status(deadline)
            self.result=InitializationResult(firmware,status,version,selected.record_index,selected.used_fallback)
            self.state='ready'
            return self.result
        except Exception as primary:
            try:self._discard()
            except Exception as cleanup:raise primary from cleanup
            raise

    def query_status(self,*,timeout=2):
        if self.state!='ready':raise RuntimeError('Session is not initialized')
        deadline=self._deadline(timeout)
        try:return self._status(deadline)
        except Exception as primary:
            try:self._discard()
            except Exception as cleanup:raise primary from cleanup
            raise

    def close(self):
        self.state='closed'
        self.result=None
        self.channel.close()

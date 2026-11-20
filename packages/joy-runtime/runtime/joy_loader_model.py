"""Pure loading-policy model. Emits INTENTS only; cannot send device commands.

Not imported by the worker and not a working hardware loader. Firmware/profile
adaptation remains gated. In particular safe_profile_verified is an assertion
from a future trusted adapter, NOT evidence supplied by this model or renderer.

Policy choices (not vendor constants): bounded overall deadline, exact supported
mat sizes, fail closed on malformed progress, measured length >= requested area.
A complete model state means accepted measurement evidence, not physical proof.
Disarming is an intent; session loss can prevent its delivery.
"""
import math
from joy_mat_codec import MAX_MEASURED_INCHES


class LoaderModel:
    _terminal = frozenset(('complete', 'failed', 'cancelled'))
    _events = frozenset(('start', 'ack', 'gripped', 'safe_profile_verified',
                         'measurement', 'cancel', 'session_lost', 'error', 'tick'))

    def __init__(self, height_inches, *, timeout=30):
        if type(height_inches) not in (int, float) or height_inches not in (6.5, 12):
            raise ValueError('Choose an original-Joy short or long mat')
        if type(timeout) not in (int, float) or not math.isfinite(timeout) or not 0 < timeout <= 120:
            raise ValueError('Invalid loader deadline')
        self.height_inches = float(height_inches)
        self.timeout = float(timeout)
        self.state = 'idle'
        self.error = None
        self.actions = ()
        self._deadline = None
        self._last_time = None
        self._armed = False

    def _emit(self, *actions):
        self.actions = actions
        return actions

    def _finish(self, state, error=None):
        self.state, self.error = state, error
        disarm = self._armed
        self._armed = False
        return self._emit(*(('disarm_sensor',) if disarm else ()))

    def handle(self, event, *, now, busy=None, length_inches=None):
        if event not in self._events:
            raise ValueError('Unknown loader event')
        if (type(now) not in (int, float) or not math.isfinite(now) or now < 0
                or (self._last_time is not None and now < self._last_time)):
            raise ValueError('Loader requires a monotonic finite clock')
        self._last_time = now
        if self.state in self._terminal:
            if event in ('cancel', 'ack', 'tick'):
                return self._emit()
            raise RuntimeError('Terminal loader cannot consume stale events; create a new model')
        if event == 'cancel':
            return self._finish('cancelled')
        if event in ('session_lost', 'error'):
            return self._finish('failed', event)
        if self._deadline is not None and now >= self._deadline:
            return self._finish('failed', 'timeout')
        if event == 'ack':
            return self._emit()
        if event == 'start' and self.state == 'idle':
            self._deadline = now + self.timeout
            self._armed = True
            self.state = 'waiting_for_mat'
            return self._emit('configure_dimensions', 'blink_ready', 'arm_sensor')
        if event == 'gripped' and self.state == 'waiting_for_mat':
            self.state = 'awaiting_safe_profile'
            return self._emit('set_ready_led', 'verify_noncut_profile')
        if event == 'safe_profile_verified' and self.state == 'awaiting_safe_profile':
            self.state = 'measuring'
            return self._emit('start_measurement')
        if event == 'measurement' and self.state == 'measuring':
            if (type(busy) is not bool or not isinstance(length_inches, (int, float))
                    or isinstance(length_inches, bool)
                    or not 0 <= length_inches <= MAX_MEASURED_INCHES
                    or not math.isfinite(length_inches)):
                return self._finish('failed', 'invalid_measurement')
            if busy:
                return self._emit('poll_measurement')
            if length_inches < self.height_inches:
                return self._finish('failed', 'material_too_short')
            return self._finish('complete')
        if event == 'tick':
            return self._emit(*(('poll_measurement',) if self.state == 'measuring' else ()))
        raise RuntimeError('Event is invalid in the current loading phase')

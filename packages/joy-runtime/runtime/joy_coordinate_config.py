"""Source-derived affine coordinate math for original Joy (not calibration).

The source proves coefficient order and arithmetic, but not which matrix is
active for a physical job. Callers must provide an explicitly sourced matrix.
"""
from dataclasses import dataclass, field
from decimal import Context, Decimal, ROUND_HALF_EVEN, localcontext
import math
from typing import Sequence, cast


def _finite_builtin(value: object) -> float:
    if type(value) not in (int, float):
        raise ValueError("Expected a finite builtin number.")
    try:
        result = float(cast(int | float, value))
    except OverflowError:
        raise ValueError("Number exceeds binary64 range.") from None
    if not math.isfinite(result):
        raise ValueError("Expected a finite builtin number.")
    return result


def _fma(a: float, b: float, c: float) -> float:
    """Correctly round a*b+c once, using exact finite-decimal operands."""
    if hasattr(math, "fma"):
        return math.fma(a, b, c)
    # An independent context avoids inheriting the caller's exponent limits,
    # traps and rounding. 2500 digits cover even min-subnormal squared plus
    # max-binary64 (2457 decimal digits); all finite binary64 operands are exact.
    with localcontext(Context(prec=2500, rounding=ROUND_HALF_EVEN,
                              Emin=-999999, Emax=999999)):
        result = Decimal.from_float(a) * Decimal.from_float(b) + Decimal.from_float(c)
    # IEEE-754 exact-zero sum is negative only when both addends are -0.
    if result.is_zero() and a * b == 0.0 and c == 0.0:
        return -0.0 if math.copysign(1.0, a * b) < 0 and math.copysign(1.0, c) < 0 else 0.0
    return float(result)


@dataclass(frozen=True)
class AffineTransform:
    """Explicit native matrix ``[a,b,c,d,e,f]``.

    Native point ABI returns ``(e + fma(a,u,c*v), f + fma(b,u,d*v))``.
    This utility makes no default-matrix, physical-axis, unit, origin or
    calibration claim. On Python builds lacking ``math.fma`` a high-precision Decimal fallback
    preserves fused rounding without mutating the caller's Decimal context.
    """
    coefficients: Sequence[float]
    _values: tuple[float, float, float, float, float, float] = field(init=False, repr=False)

    def __post_init__(self) -> None:
        raw = self.coefficients
        if type(raw) not in (tuple, list) or len(raw) != 6:
            raise ValueError("Affine matrix must contain exactly six coefficients.")
        values = tuple(_finite_builtin(v) for v in raw)
        object.__setattr__(self, "coefficients", values)
        object.__setattr__(self, "_values", values)

    def apply(self, point: Sequence[float]) -> tuple[float, float]:
        if type(point) not in (tuple, list) or len(point) != 2:
            raise ValueError("Point must contain exactly two coordinates.")
        u, v = (_finite_builtin(x) for x in point)
        a, b, c, d, e, f = self._values
        try:
            out_u = e + _fma(a, u, c * v)
            out_v = f + _fma(b, u, d * v)
        except (OverflowError, ValueError):
            raise ValueError("Affine transform result exceeds numeric range.") from None
        if not math.isfinite(out_u) or not math.isfinite(out_v):
            raise ValueError("Affine transform result is nonfinite.")
        return out_u, out_v

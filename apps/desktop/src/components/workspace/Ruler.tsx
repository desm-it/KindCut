import type { MeasurementUnit } from "../../workspace-utils";
import { getMeasurementTicks } from "../../workspace-utils";

export function Ruler({ axis, ticks, unit }: { axis: "x" | "y"; ticks: ReturnType<typeof getMeasurementTicks>; unit: MeasurementUnit }) {
  return (
    <div className={`ruler ruler--${axis}`} aria-label={`${axis.toUpperCase()} ruler in ${unit}`}>
      <span className="ruler__unit">{unit}</span>
      {ticks.map((tick) => (
        <span
          key={`${axis}-${tick.value}`}
          className={tick.major ? "ruler__tick ruler__tick--major" : "ruler__tick"}
          style={axis === "x" ? { left: tick.position } : { top: tick.position }}
        >
          {tick.label ? <em>{tick.label}</em> : null}
        </span>
      ))}
    </div>
  );
}

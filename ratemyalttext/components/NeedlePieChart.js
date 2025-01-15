import React from "react";
import { PieChart, Pie, Cell } from "recharts";

const NeedlePieChart = ({ value }) => {
  const RADIAN = Math.PI / 180;
  const data = [
    { name: "Bad", value: 25, color: "#FF4D4D" },
    { name: "Decent", value: 25, color: "#FFC107" },
    { name: "Good", value: 25, color: "#4CAF50" },
    { name: "Amazing", value: 25, color: "#3F51B5" },
  ];
  const cx = 150;
  const cy = 150;
  const iR = 70;
  const oR = 100;

  const needle = (value, data, cx, cy, iR, oR, color) => {
    const total = data.reduce((sum, entry) => sum + entry.value, 0);
    const angle = 180.0 * (1 - value / total);
    const length = (iR + 2 * oR) / 3;
    const sin = Math.sin(-RADIAN * angle);
    const cos = Math.cos(-RADIAN * angle);
    const r = 5;
    const x0 = cx;
    const y0 = cy;
    const xp = x0 + length * cos;
    const yp = y0 + length * sin;

    return (
      <>
        <circle cx={x0} cy={y0} r={r} fill={color} />
        <path d={`M${x0} ${y0} L${xp} ${yp}`} stroke={color} strokeWidth="2" />
      </>
    );
  };

  return (
    <PieChart width={300} height={300}>
      <Pie
        dataKey="value"
        startAngle={180}
        endAngle={0}
        data={data}
        cx={cx}
        cy={cy}
        innerRadius={iR}
        outerRadius={oR}
        stroke="none"
      >
        {data.map((entry, index) => (
          <Cell key={`cell-${index}`} fill={entry.color} />
        ))}
      </Pie>
      {needle(value, data, cx, cy, iR, oR, "#000")}
    </PieChart>
  );
};

export default NeedlePieChart;

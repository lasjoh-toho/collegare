import * as React from "react";
import type { SVGProps } from "react";
const SvgLogo = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 256 256"
    {...props}
  >
    <rect
      width={217.413}
      height={217.413}
      x={38.587}
      y={19.293}
      fill="#FF5900"
      rx={108.707}
    />
    <rect
      width={217.413}
      height={217.413}
      x={38.587}
      y={19.293}
      stroke="#FF5900"
      rx={108.707}
    />
    <rect width={114.234} height={114.234} y={92.004} fill="url(#a)" rx={8} />
    <path
      fill="#fff"
      d="M88.66 149.06q0 10.912-4.196 18.5-4.198 7.587-11.365 11.526-7.136 3.939-16.014 3.939-8.912 0-16.047-3.971t-11.332-11.527q-4.165-7.587-4.165-18.467 0-10.913 4.165-18.501 4.197-7.587 11.332-11.526t16.047-3.939q8.879 0 16.014 3.939 7.167 3.939 11.364 11.526 4.198 7.588 4.198 18.501m-16.336 0q0-6.458-1.84-10.913-1.81-4.456-5.23-6.748-3.39-2.292-8.17-2.292-4.745 0-8.168 2.292t-5.262 6.748q-1.809 4.455-1.809 10.913 0 6.457 1.809 10.912 1.839 4.456 5.262 6.748t8.169 2.292q4.778 0 8.168-2.292 3.423-2.292 5.23-6.748 1.84-4.456 1.84-10.912"
    />
    <path
      fill="#fff"
      fillOpacity={0.85}
      d="M227.293 128h-79.999s.001-53.073-.001-80c44.183 0 80 35.817 80 80"
    />
    <defs>
      <linearGradient
        id="a"
        x1={5.901}
        x2={105.223}
        y1={99.933}
        y2={200.025}
        gradientUnits="userSpaceOnUse"
      >
        <stop stopColor="#ED4801" />
        <stop offset={1} stopColor="#C33B00" />
      </linearGradient>
    </defs>
  </svg>
);
export default SvgLogo;

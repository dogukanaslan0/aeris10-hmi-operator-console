import { useEffect, useState } from 'react';
import './Odometer.css';

interface OdometerProps {
  value: string | number;
}

export function Odometer({ value }: OdometerProps) {
  const valueStr = String(value);
  const chars = valueStr.split('');

  return (
    <span className="odometer" aria-label={valueStr}>
      {chars.map((char, index) => {
        const isDigit = /\d/.test(char);
        if (!isDigit) {
          return (
            <span key={index} className="odometer__separator">
              {char}
            </span>
          );
        }
        return <OdometerDigit key={index} digit={parseInt(char, 10)} />;
      })}
    </span>
  );
}

function OdometerDigit({ digit }: { digit: number }) {
  const [animatedDigit, setAnimatedDigit] = useState(digit);

  useEffect(() => {
    setAnimatedDigit(digit);
  }, [digit]);

  // Strip of numbers from 0 to 9
  const numbers = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

  return (
    <span className="odometer__digit-container">
      <span
        className="odometer__digit-strip"
        style={{
          transform: `translateY(-${animatedDigit * 10}%)`,
        }}
      >
        {numbers.map((n) => (
          <span key={n} className="odometer__digit-number">
            {n}
          </span>
        ))}
      </span>
    </span>
  );
}

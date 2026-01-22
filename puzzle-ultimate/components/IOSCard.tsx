import React from 'react';

interface IOSCardProps {
  children: React.ReactNode;
  className?: string;
  noPadding?: boolean;
}

export const IOSCard: React.FC<IOSCardProps> = ({ children, className = '', noPadding = false }) => {
  return (
    <div className={`bg-white rounded-xl overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.03)] mb-5 contain-content ${className}`}>
      {noPadding ? children : <div className="p-4">{children}</div>}
    </div>
  );
};
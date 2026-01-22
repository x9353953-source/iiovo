import React, { useState } from 'react';

interface AccordionProps {
  title: React.ReactNode;
  subtitle?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  rightElement?: React.ReactNode;
}

export const Accordion: React.FC<AccordionProps> = ({ title, subtitle, children, defaultOpen = false, rightElement }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="bg-white">
      <div 
        className="flex items-center justify-between p-4 bg-white cursor-pointer select-none active:bg-gray-50 transition"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex-1">
           {typeof title === 'string' ? <div className="text-[17px] font-bold">{title}</div> : title}
           {subtitle && <div className="text-[10px] text-gray-400 mt-0.5">{subtitle}</div>}
        </div>
        {rightElement && <div className="mr-3" onClick={(e) => e.stopPropagation()}>{rightElement}</div>}
        <svg 
          className={`w-4 h-4 text-gray-400 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} 
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path>
        </svg>
      </div>
      {isOpen && (
        <div className="border-t border-gray-100 animate-fade-in">
          {children}
        </div>
      )}
    </div>
  );
};
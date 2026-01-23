import React from 'react';

export const IOSCard: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={`bg-white rounded-xl overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.03)] mb-5 ${className}`}>
    {children}
  </div>
);

export const IOSToggle: React.FC<{ checked: boolean; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void }> = ({ checked, onChange }) => (
  <label className="relative inline-flex items-center cursor-pointer">
    <input type="checkbox" checked={checked} onChange={onChange} className="sr-only peer" />
    <div className="w-[51px] h-[31px] bg-[#E9E9EA] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-[27px] after:w-[27px] after:shadow-sm after:transition-all peer-checked:bg-[#34C759]"></div>
  </label>
);

export const IOSButton: React.FC<{ onClick: () => void; children: React.ReactNode; variant?: 'primary' | 'danger' | 'default'; className?: string }> = ({ onClick, children, variant = 'default', className = '' }) => {
  let baseClass = "text-[15px] font-bold px-4 py-1.5 rounded-full shadow-sm transition flex items-center gap-1 ";
  if (variant === 'primary') baseClass += "bg-white text-[#007AFF] active:bg-gray-100";
  else if (variant === 'danger') baseClass += "bg-white text-[#FF3B30] active:bg-gray-100";
  else baseClass += "bg-gray-100 text-gray-500 active:bg-gray-200";

  return (
    <button onClick={onClick} className={`${baseClass} ${className}`}>
      {children}
    </button>
  );
};

export const Accordion: React.FC<{ title: string; subtitle?: string; isOpen?: boolean; children: React.ReactNode, icon?: React.ReactNode }> = ({ title, subtitle, isOpen = false, children, icon }) => (
  <details className="group" open={isOpen}>
    <summary className="flex items-center justify-between p-4 bg-white cursor-pointer select-none active:bg-gray-50 transition list-none">
      <div>
        <div className="text-[17px] font-bold flex items-center gap-2">
            {icon} {title}
        </div>
        {subtitle && <div className="text-[10px] text-gray-400 mt-0.5">{subtitle}</div>}
      </div>
      <svg className="w-4 h-4 text-gray-400 group-open:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
    </summary>
    <div className="divide-y divide-gray-200 border-t border-gray-100">
      {children}
    </div>
  </details>
);

export const SettingRow: React.FC<{ label: string; children: React.ReactNode; subLabel?: string }> = ({ label, children, subLabel }) => (
  <div className="p-4 bg-white active:bg-gray-50 transition">
    <div className="flex items-center justify-between">
      <span className="text-[17px]">{label}</span>
      {children}
    </div>
    {subLabel && <div className="text-[10px] text-gray-400 mt-1">{subLabel}</div>}
  </div>
);
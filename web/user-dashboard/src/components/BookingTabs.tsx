import React from 'react';

interface Tab {
  id: string;
  label: string;
  count?: number;
}

interface BookingTabsProps {
  tabs: Tab[];
  activeTab: string;
  onChange: (tabId: string) => void;
}

const BookingTabs: React.FC<BookingTabsProps> = ({ tabs, activeTab, onChange }) => {
  return (
    <div
      style={{
        display: 'flex',
        gap: '4px',
        padding: '4px',
        background: '#F1F5F9',
        borderRadius: '12px',
        marginBottom: '24px',
        width: 'fit-content',
      }}
    >
      {tabs.map(tab => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            style={{
              padding: '9px 20px',
              borderRadius: '9px',
              border: 'none',
              background: isActive ? 'white' : 'transparent',
              color: isActive ? '#1E293B' : '#64748B',
              fontWeight: isActive ? 700 : 500,
              fontSize: '14px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              boxShadow: isActive ? '0 1px 4px rgba(0,0,0,0.1)' : 'none',
              transition: 'all 0.15s',
            }}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minWidth: '20px',
                  height: '20px',
                  padding: '0 6px',
                  borderRadius: '9999px',
                  background: isActive ? '#1E40AF' : '#CBD5E1',
                  color: isActive ? 'white' : '#475569',
                  fontSize: '11px',
                  fontWeight: 700,
                }}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};

export default BookingTabs;

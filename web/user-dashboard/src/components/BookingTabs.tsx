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
    <div className="ui-segmented" role="tablist" aria-label="Bookings">
      {tabs.map(tab => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`ui-segmented__item${isActive ? ' is-active' : ''}`}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
            {tab.count !== undefined && <span className="ui-count">{tab.count}</span>}
          </button>
        );
      })}
    </div>
  );
};

export default BookingTabs;

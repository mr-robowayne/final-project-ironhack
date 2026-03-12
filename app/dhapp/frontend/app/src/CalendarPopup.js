import React from 'react';
import CalendarView from './main_kalender';
import './CalendarPopup.css';

const CalendarPopup = ({ onClose }) => {
  return (
    <div className="calendar-popup-overlay">
      <div className="calendar-popup-content">
        <button className="calendar-close-btn" onClick={onClose}>✖</button>
        <CalendarView />
      </div>
    </div>
  );
};

export default CalendarPopup;

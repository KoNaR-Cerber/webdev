import React from 'react';

const BatteryBar = ({ label, percentage }) => {
    // Fallback to 0 if undefined
    const level = percentage || 0; 

    const getBatteryColor = (val) => {
        if (val > 60) return '#4caf50'; // Green
        if (val > 20) return '#ff9800'; // Orange
        return '#f44336';                 // Red
    };

    return (
        <div style={{ marginBottom: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ color: '#ccc', fontSize: '14px', fontWeight: 'bold' }}>{label}</span>
                <span style={{ color: getBatteryColor(level), fontSize: '14px', fontWeight: 'bold' }}>
                    {level}%
                </span>
            </div>
            
            <div style={{ background: '#444', height: '16px', borderRadius: '8px', overflow: 'hidden', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.5)' }}>
                <div 
                    style={{ 
                        width: `${level}%`, 
                        background: getBatteryColor(level), 
                        height: '100%',
                        transition: 'width 0.5s ease-in-out, background-color 0.5s ease'
                    }} 
                />
            </div>
        </div>
    );
};

export default BatteryBar;
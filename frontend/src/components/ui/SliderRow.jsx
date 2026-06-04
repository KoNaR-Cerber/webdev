import React from "react";

const SliderRow = ({ label, value, min, max, step, onChange }) => {
    return (
        <div style={{ marginBottom: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '14px' }}>
                <span>{label}</span>
                <span style={{ fontWeight: 'bold', color: 'var(--accent-blue)' }}>
                    {Number(value).toFixed(2)}
                </span>
            </div>
            <input 
                type="range" 
                min={min} 
                max={max} 
                step={step} 
                value={value} 
                onChange={(e) => onChange(e.target.value)}
                style={{ 
                    width: '100%', 
                    accentColor: 'var(--accent-blue)',
                    cursor: 'pointer'
                }}
            />
        </div>
    );
};

export default SliderRow;

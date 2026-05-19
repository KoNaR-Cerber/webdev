//   
//  This is the function for the different widget cards
// 
import React from 'react';

const Card = ({ title, children }) => {
    return (
        <div style={cardStyle}>
            {/* The "widget-header" class is what react-grid-layout uses to drag */}
            <div className="widget-header" style={headerStyle}>
                {title}
            </div>
            <div style={contentStyle}>
                {children}
            </div>
        </div>
    );
};

const cardStyle = {
    background: '#222',
    borderRadius: '8px',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    width: '100%',
    boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
};

const headerStyle = {
    background: '#333',
    color: '#eee',
    padding: '8px 12px',
    cursor: 'grab',
    userSelect: 'none',
    fontWeight: 'bold',
    fontSize: '14px',
    borderBottom: '1px solid #444',
};

const contentStyle = {
    flex: 1,
    position: 'relative',
    padding: '8px', // Optional padding for the inside of your widgets
    overflow: 'hidden',
};

export default Card;
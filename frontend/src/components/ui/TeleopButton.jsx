import React from "react";

const TeleopButton = ({
    label,
    action,
    isActive,
    isConnected,
    onPointerDown,
    onPointerUp,
    activeColor = '#2196f3'
}) => {
    const connected = isConnected !== undefined ? isConnected : true;

    const style = {
        width: '40px',
        height: '40px',
        background: !connected ? '#2a2a2a' : isActive ? activeColor : '#444',
        color: connected ? (isActive ? 'white' : '#ccc') : '#555',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '6px',
        fontWeight: 'bold',
        margin: '4px',
        cursor: connected ? 'pointer' : 'not-allowed',
        transition: 'background 0.1s',
        boxShadow: isActive && connected
            ? 'inset 0 3px 5px rgba(0,0,0,0.5)'
            : '0 4px 6px rgba(0,0,0,0.3)',
        transform: isActive && connected ? 'translateY(2px)' : 'none',
        userSelect: 'none',
        touchAction: 'none'
    };

    return (
        <div
            style={style}
            onPointerDown={() => connected && onPointerDown(action)}
            onPointerUp={() => connected && onPointerUp(action)}
            onPointerLeave={() => connected && onPointerUp(action)}
        >
            {label}
        </div>
    )
}

export default TeleopButton;

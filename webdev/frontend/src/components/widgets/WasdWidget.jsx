import React, { useState, useEffect, useCallback } from 'react';
import { useRobot } from '../../context/RobotContext';

const WasdWidget = () => {
    const { sendCommand } = useRobot();
    const [keys, setKeys] = useState({ W: false, A: false, S: false, D: false });

    // Calculate and publish velocity whenever the key state changes
    useEffect(() => {
        // Forward/back (W is positive X, S is negative X)
        const linearX = (keys.W ? 1.0 : 0.0) + (keys.S ? -1.0 : 0.0);
        
        // Turn left/right (A is positive Z [CCW], D is negative Z [CW])
        const angularZ = (keys.A ? 1.0 : 0.0) + (keys.D ? -1.0 : 0.0);

        const twistMsg = {
            linear: { x: linearX, y: 0.0, z: 0.0 },
            angular: { x: 0.0, y: 0.0, z: angularZ }
        };

        sendCommand('/cmd_vel_server', 'geometry_msgs/Twist', twistMsg);
    }, [keys, sendCommand]);

    const handleKeyDown = useCallback((e) => {
        const key = e.key.toUpperCase();
        if (['W', 'A', 'S', 'D'].includes(key)) {
            setKeys(prev => {
                if (prev[key]) return prev; // Ignore OS auto-repeat keydowns
                return { ...prev, [key]: true };
            });
        }
    }, []);

    const handleKeyUp = useCallback((e) => {
        const key = e.key.toUpperCase();
        if (['W', 'A', 'S', 'D'].includes(key)) {
            setKeys(prev => ({ ...prev, [key]: false }));
        }
    }, []);

    useEffect(() => {
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, [handleKeyDown, handleKeyUp]);

    // Simple helper for visual styling
    const getKeyStyle = (isActive) => ({
        width: '40px',
        height: '40px',
        background: isActive ? '#0a71df' : '#444',
        color: 'white',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '6px',
        fontWeight: 'bold',
        margin: '4px',
        transition: 'background 0.1s',
        boxShadow: isActive ? 'inset 0 3px 5px rgba(0,0,0,0.5)' : '0 4px 6px rgba(0,0,0,0.3)',
        transform: isActive ? 'translateY(2px)' : 'none'
    });

    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '16px' }}>
            <div style={{ display: 'flex' }}>
                <div style={getKeyStyle(keys.W)}>W</div>
            </div>
            <div style={{ display: 'flex' }}>
                <div style={getKeyStyle(keys.A)}>A</div>
                <div style={getKeyStyle(keys.S)}>S</div>
                <div style={getKeyStyle(keys.D)}>D</div>
            </div>
            <div style={{ marginTop: '16px', color: '#888', fontSize: '12px' }}>
                Global Keyboard Control Active
            </div>
        </div>
    );
};

export default WasdWidget;
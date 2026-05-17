import React, { useState, useEffect, useCallback } from 'react';
import { useRobot } from '../../context/RobotContext';

const PanTiltWidget = () => {
    const { sendCommand } = useRobot();
    const [keys, setKeys] = useState({UP: false, DOWN: false, LEFT: false, RIGHT: false});

    useEffect(() => {
        const pan = (keys.LEFT ? 1.0 : 0.0) + (keys.RIGHT ? -1.0 : 0.0);
        const tilt = (keys.UP ? 1.0 : 0.0) + (keys.DOWN ? -1.0 : 0.0);

        const twistMsg = {
                linear: {x: 0.0, y: 0.0, z: 0.0 },
                angular: {x: 0.0, y: tilt, z: pan}  // might need to be changed later
            };

            sendCommand('camera/cmd_vel', 'geometry_msgs/Twist', twistMsg);
    }, [keys, sendCommand]);

    const handleKeyDown = useCallback((e) => {
        switch(e.key) {
            case 'ArrowUp': setKeys(p => p.UP ? p : { ...p, UP: true }); break;
            case 'ArrowDown': setKeys(p => p.DOWN ? p : { ...p, DOWN: true }); break;
            case 'ArrowLeft': setKeys(p => p.LEFT ? p : { ...p, LEFT: true }); break;
            case 'ArrowRight': setKeys(p => p.RIGHT ? p : { ...p, RIGHT: true }); break;
            default: break;
        }
    }, []);

    const handleKeyUp = useCallback((e) => {
        switch(e.key) {
            case 'ArrowUp': setKeys(p => ({ ...p, UP: false })); break;
            case 'ArrowDown': setKeys(p => ({ ...p, DOWN: false })); break;
            case 'ArrowLeft': setKeys(p => ({ ...p, LEFT: false })); break;
            case 'ArrowRight': setKeys(p => ({ ...p, RIGHT: false })); break;
            default: break;
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

    const handlePointerDown = (dir) => setKeys(prev => ({ ...prev, [dir]: true }));
    const handlePointerUp = (dir) => setKeys(prev => ({ ...prev, [dir]: false }));

    const getBtnStyle = (isActive) => ({
        width: '40px',
        height: '40px',
        background: isActive ? '#f44336' : '#444', // Red to distinguish from drive controls
        color: 'white',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '6px',
        fontWeight: 'bold',
        margin: '4px',
        cursor: 'pointer',
        transition: 'background 0.1s',
        boxShadow: isActive ? 'inset 0 3px 5px rgba(0,0,0,0.5)' : '0 4px 6px rgba(0,0,0,0.3)',
        transform: isActive ? 'translateY(2px)' : 'none',
        userSelect: 'none',
        touchAction: 'none' // Prevents mobile browser scrolling while dragging
    });

    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '16px' }}>
            <div style={{ display: 'flex' }}>
                <div 
                    style={getBtnStyle(keys.UP)}
                    onPointerDown={() => handlePointerDown('UP')}
                    onPointerUp={() => handlePointerUp('UP')}
                    onPointerLeave={() => handlePointerUp('UP')}
                >
                    ▲
                </div>
            </div>
            <div style={{ display: 'flex' }}>
                <div 
                    style={getBtnStyle(keys.LEFT)}
                    onPointerDown={() => handlePointerDown('LEFT')}
                    onPointerUp={() => handlePointerUp('LEFT')}
                    onPointerLeave={() => handlePointerUp('LEFT')}
                >
                    ◄
                </div>
                <div 
                    style={getBtnStyle(keys.DOWN)}
                    onPointerDown={() => handlePointerDown('DOWN')}
                    onPointerUp={() => handlePointerUp('DOWN')}
                    onPointerLeave={() => handlePointerUp('DOWN')}
                >
                    ▼
                </div>
                <div 
                    style={getBtnStyle(keys.RIGHT)}
                    onPointerDown={() => handlePointerDown('RIGHT')}
                    onPointerUp={() => handlePointerUp('RIGHT')}
                    onPointerLeave={() => handlePointerUp('RIGHT')}
                >
                    ►
                </div>
            </div>
            <div style={{ marginTop: '16px', color: '#888', fontSize: '12px', textAlign: 'center' }}>
                Arrow Keys or UI
            </div>
        </div>
    );
  
};

export default PanTiltWidget;
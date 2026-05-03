import React, { useEffect, useRef } from 'react';
import nipplejs from 'nipplejs';
import { useRobot } from '../../context/RobotContext';
import { throttle } from 'lodash';

const JoystickWidget = () => {
    const joyRef = useRef(null);
    const { sendCommand } = useRobot();

    // throttle sends the data at most every 50ms
    const handleMove = throttle((data) => {
        sendCommand('move', {
            x: data.vector.x,
            y: data.vector.y,
            force: data.force
        });
    }, 50);

    useEffect(() => {
        const manager = nipplejs.create({
            zone: joyRef.current,
            mode: 'static',
            position: {left: '50%', top: '50%'},
            color: '#0a71df'
        });

        manager.on('move', (evt, data) => handleMove(data));
        manager.on('end', () => sendCommand('move', { x: 0, y: 0, force: 0}));
        
        return () => manager.destroy();
    }, [sendCommand]);

    return (
        <div style={{width: '100%', height: '100%', background: '#222', position: 'relative' }}>
            <div ref={joyRef} style={{height: '100%' }} />
        </div>
    );
};

export default JoystickWidget;
import React, { useEffect, useRef, useCallback } from 'react';
import nipplejs from 'nipplejs';
import { useRobot } from '../../context/RobotContext';
import { throttle } from 'lodash';

const JoystickWidget = () => {
    const joyRef = useRef(null);
    const joystickInstance = useRef(null);
    const { sendCommand } = useRobot();

    // Keep a mutable ref of the latest sendCommand to prevent mid-drag destruction
    const sendCommandRef = useRef(sendCommand);
    useEffect(() => {
        sendCommandRef.current = sendCommand;
    }, [sendCommand]);

    const handleMove = useCallback(
        throttle((data) => {
            const force = Math.min(data.force, 1);
            const angleRad = data.angle.radian;
            const forwardSpeed = Math.sin(angleRad) * force;
            const turnSpeed = Math.cos(angleRad) * force * -1;

            const twistMsg = {
                linear: { x: forwardSpeed, y: 0.0, z: 0.0 },
                angular: { x: 0.0, y: 0.0, z: turnSpeed }
            };
            
            sendCommandRef.current('cmd_vel', twistMsg);
        }, 100),
        [] 
    );

    const handleStop = useCallback(() => {
        const stopMsg = {
            linear: { x: 0.0, y: 0.0, z: 0.0 },
            angular: { x: 0.0, y: 0.0, z: 0.0 }
        };
        sendCommandRef.current('cmd_vel', stopMsg);
    }, []);

    // SINGLE, CONSOLIDATED USE-EFFECT
    useEffect(() => {
        if (!joyRef.current) return;

        const initJoystick = () => {
            if (joystickInstance.current) {
                joystickInstance.current.destroy();
            }

            joystickInstance.current = nipplejs.create({
                zone: joyRef.current,
                mode: 'static',
                position: { left: '50%', top: '50%' },
                color: '#0a71df'
            });

            joystickInstance.current.on('move', (evt, data) => handleMove(data));
            joystickInstance.current.on('end', handleStop);
        };

        // 1. Initial Delay 
        const timeoutId = setTimeout(initJoystick, 100);

        // 2. Resize Observer (Window resizing / Widget reshaping)
        let lastWidth = 0;
        let lastHeight = 0;
        const resizeObserver = new ResizeObserver((entries) => {
            for (let entry of entries) {
                const { width, height } = entry.contentRect;
                if (Math.abs(width - lastWidth) > 1 || Math.abs(height - lastHeight) > 1) {
                    if (lastWidth !== 0) initJoystick();
                    lastWidth = width;
                    lastHeight = height;
                }
            }
        });
        resizeObserver.observe(joyRef.current);

        // 3. Mutation Observer (Dragging the widget)
        let moveTimeout;
        const gridItem = joyRef.current.closest('.react-grid-item'); 
        
        const styleObserver = new MutationObserver((mutations) => {
            for (let mutation of mutations) {
                if (mutation.attributeName === 'style') {
                    clearTimeout(moveTimeout);
                    moveTimeout = setTimeout(initJoystick, 150);
                }
            }
        });

        if (gridItem) {
            styleObserver.observe(gridItem, { attributes: true });
        }

        // 4. Master Cleanup
        return () => {
            clearTimeout(timeoutId);
            clearTimeout(moveTimeout);
            resizeObserver.disconnect();
            styleObserver.disconnect(); 
            
            if (joystickInstance.current) {
                joystickInstance.current.destroy();
            }
            handleMove.cancel(); 
        };
    }, [handleMove, handleStop]); 

    return (
        <div style={{ width: '100%', height: '100%', minHeight: '150px' }}>
            <div 
                ref={joyRef} 
                style={{ width: '100%', height: '100%', position: 'relative' }} 
            />
        </div>
    );
};

export default JoystickWidget;
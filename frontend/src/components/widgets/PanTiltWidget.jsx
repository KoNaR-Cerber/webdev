import React, { useEffect, useState } from 'react';
import { useRobot } from '../../context/RobotContext';
import { useTeleopControls } from '../../hooks/useTeleopControls';
import TeleopButton from '../ui/TeleopButton';

// Map arrow keys to directional actions
const PAN_TILT_MAP = {
    'ARROWUP': 'UP',
    'ARROWDOWN': 'DOWN',
    'ARROWLEFT': 'LEFT',
    'ARROWRIGHT': 'RIGHT'
};

const PanTiltWidget = () => {
    const { connectionStatus, sendCommand, ros } = useRobot();
    const isConnected = connectionStatus === "CONNECTED";
    
    const [ptzStatus, setPtzStatus] = useState("UNKNOWN");

    const { activeKeys, handlePointerDown, handlePointerUp } = useTeleopControls(PAN_TILT_MAP);

    // 1. Command Publisher Effect
    useEffect(() => {
        if (!isConnected) return;

        // X corresponds to Left/Right 
        const panX = (activeKeys.RIGHT ? 1.0 : 0.0) + (activeKeys.LEFT ? -1.0 : 0.0);
        
        // Y corresponds to Up/Down
        const tiltY = (activeKeys.UP ? 1.0 : 0.0) + (activeKeys.DOWN ? -1.0 : 0.0);

        const twistMsg = {
            linear: { x: panX, y: tiltY, z: 0.0 },
            angular: { x: 0.0, y: 0.0, z: 0.0 } 
        };

        sendCommand('/ptz/cmd_vel', 'geometry_msgs/Twist', twistMsg);
    }, [activeKeys, sendCommand, isConnected]);

    // 2. Status Subscriber Effect
    useEffect(() => {
        if (!isConnected || !ros) return;

        // Create a listener for the PTZ status topic
        const ptzStatusListener = new ROSLIB.Topic({
            ros: ros,
            name: '/ptz/status',
            messageType: 'std_msgs/String'
        });

        ptzStatusListener.subscribe((message) => {
            // Expected format: "[PTZ] WAITING | IP: 192.168.137.184"
            try {
                // Split by '|' to separate the payload from the IP, then remove '[PTZ]' and trim whitespace
                const payload = message.data.split('|')[0].replace('[PTZ]', '').trim();
                setPtzStatus(payload);
            } catch (error) {
                console.warn("Failed to parse PTZ status:", message.data);
                setPtzStatus("PARSE ERROR");
            }
        });

        // Cleanup listener on unmount or disconnect
        return () => {
            ptzStatusListener.unsubscribe();
        };
    }, [ros, isConnected]);

    const getStatusColor = (status) => {
        switch(status) {
            case "MOVING": return "#ff9800"; // Orange
            case "WAITING": return "#4caf50"; // Green
            case "DISCONNECTED": return "#f44336"; // Red
            default: return "#9e9e9e"; // Gray
        }
    };

    const renderBtn = (label, action) => (
        <TeleopButton 
            label={label} action={action} isActive={activeKeys[action]} 
            isConnected={isConnected} onPointerDown={handlePointerDown} onPointerUp={handlePointerUp} 
            activeColor="#f44336" 
        />
    );

    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '16px' }}>
            <div style={{ display: 'flex' }}>
                {renderBtn("▲", "UP")}
            </div>
            <div style={{ display: 'flex' }}>
                {renderBtn("◄", "LEFT")}
                {renderBtn("▼", "DOWN")}
                {renderBtn("►", "RIGHT")}
            </div>
            
            <div style={{ marginTop: '16px', color: '#888', fontSize: '12px', textAlign: 'center' }}>
                Arrow Keys or UI
            </div>
            
            {/* PTZ Real-time Status Display */}
            <div style={{ marginTop: '8px', color: getStatusColor(ptzStatus), fontSize: '13px', fontWeight: 'bold' }}>
                PTZ: {ptzStatus}
            </div>
        </div>
    );
};

export default PanTiltWidget;
// Stand up, sit down and etc
import React, { useState } from "react";
import { useRobot } from "../../context/RobotContext";

const ActionPanel = () => {
    const { connectionStatus, sendCommand } = useRobot();
    const isConnected = connectionStatus === "CONNECTED";

    const [isAlarmActive, setIsAlarmActive] = useState(false)

    const handleSitStand = () => {
        if(!isConnected) return;

        const msg ={ cmd_code: 1, size: 0, type: 1};
        sendCommand('/robot/simple_cmd', 'transfer_interfaces/MotionSimpleCMD', msg); // /robot/ może być niepotrzebne
    };

    const handleAlarmDown = () => {
        if(!isConnected) return;
        setIsAlarmActive(true);

        sendCommand('/alarm/turn_on', 'std_msgs/Bool', {data: true});
    };

    const handleAlarmUp = () => {
        if(!isConnected) return;
        setIsAlarmActive(false);

        sendCommand('/alarm/turn_on', 'std_msgs/Bool', {data: false});
    }

    const baseBtnStyle = {
        padding: '16px 24px',
        fontSize: '16px',
        fontWeight: 'bold',
        color: 'white',
        border: 'none',
        borderRadius: '8px',
        cursor: isConnected ? 'pointer' : 'not-allowed',
        opacity: isConnected ? 1 : 0.5,
        userSelect: 'none',
        touchAction: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        maxWidth: '200px',
        transition: 'transform 0.1s, background-color 0.1s',
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '16px', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            
            <button 
                style={{ 
                    ...baseBtnStyle, 
                    background: '#2196f3',
                    boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
                }}
                onClick={handleSitStand}
                disabled={!isConnected}
            >
                Sit / Stand Up
            </button>

            <button 
                style={{ 
                    ...baseBtnStyle, 
                    background: isAlarmActive ? '#d32f2f' : '#f44336',
                    transform: isAlarmActive ? 'translateY(2px)' : 'none',
                    boxShadow: isAlarmActive ? 'inset 0 3px 5px rgba(0,0,0,0.5)' : '0 4px 6px rgba(0,0,0,0.3)'
                }}
                onPointerDown={handleAlarmDown}
                onPointerUp={handleAlarmUp}
                onPointerLeave={() => { if (isAlarmActive) handleAlarmUp(); }}
                disabled={!isConnected}
            >
                Sound Alarm
            </button>

        </div>
    );
};

export default ActionPanel;

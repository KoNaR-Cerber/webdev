// Stand up, sit down and etc
import React, { useEffect, useState, useRef } from "react";
import { useRobot } from "../../context/RobotContext";
import { useTeleopControls } from "../../hooks/useTeleopControls";
import TeleopButton from "../ui/TeleopButton";

const ACTION_KEY_MAP = {
    'Z': 'SIT_STAND',
    ' ': 'ALARM'
};

const ActionPanel = () => {
    const { connectionStatus, sendCommand } = useRobot();
    const isConnected = connectionStatus === "CONNECTED";

    const { activeKeys, handlePointerDown, handlePointerUp } = useTeleopControls(ACTION_KEY_MAP);

    const prevSitStand = useRef(false);
    const prevAlarm = useRef(false);

    // logic for sit/stand command
    useEffect(() => {
        if (activeKeys.SIT_STAND && !prevSitStand.current) {
            if (isConnected) {
                sendCommand('/robot/simple_cmd', 'transfer_interfaces/MotionSimpleCMD', { cmd_code: 1, size: 0, type: 1 });
            }
        }
        prevSitStand.current = !!activeKeys.SIT_STAND;
    }, [activeKeys.SIT_STAND, isConnected, sendCommand]);

    useEffect(() => {
        if (!!activeKeys.ALARM !== prevAlarm.current) {
            if (isConnected) {
                sendCommand('/alarm/turn_on', 'std_msgs/Bool', { data: !!activeKeys.ALARM });
            }
            prevAlarm.current = !!activeKeys.ALARM;
        }
    }, [activeKeys.ALARM, isConnected, sendCommand]);
    const panelBtnStyle = {
        width: '100%',
        maxWidth: '200px',
        height: 'auto',
        padding: '16px 24px',
        fontSize: '16px',
    };

    return (
        <div style={{ 
            display: 'flex', 
            flexDirection: 'column', 
            gap: '10px', 
            alignItems: 'center', 
            justifyContent: 'center' }}
            >            
            <TeleopButton 
                label="Sit / Stand Up"
                action="SIT_STAND"
                isActive={activeKeys.SIT_STAND}
                isConnected={isConnected}
                onPointerDown={handlePointerDown}
                onPointerUp={handlePointerUp}
                inactiveColor="#2196f3"
                activeColor="#1565c0"
                customStyle={panelBtnStyle}
            />

            <TeleopButton 
                label="Sound Alarm"
                action="ALARM"
                isActive={activeKeys.ALARM}
                isConnected={isConnected}
                onPointerDown={handlePointerDown}
                onPointerUp={handlePointerUp}
                inactiveColor="#c62828"
                activeColor="#fa4a3d"
                customStyle={panelBtnStyle}
            />

            <div style={{ marginTop: '16px', color: 'var(--text-secondary)', fontSize: '12px', textAlign: 'center' }}>
                Buttons: [Z] Sit/Stand, [Spacebar] Alarm
            </div>
        </div>
    );
};

export default ActionPanel;

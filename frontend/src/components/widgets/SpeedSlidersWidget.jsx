// 
// 
//    TO BE REMOVED ??
// 
// 

import React from "react";
import { useRobot } from "../../context/RobotContext";
import SliderRow from "../ui/SliderRow";
import { values } from "lodash";

const SpeedSlidersWidget = () => {
    const { speeds, setSpeeds } = useRobot();
    
    const handleSpeedChange = (axis, value) => {
        setSpeeds(prev => ({ ...prev, [axis]: parseFloat(value) }));
    };
    
    return (
        //  className="widget-container" 
        <div  style={{ justifyContent: 'center' }}>
            <SliderRow 
                label="Dog X (Forward/Backward)" 
                value={speeds.dogX} 
                min="0" max="5" step="0.1" 
                onChange={(val) => handleSpeedChange('dogX', val)} 
            />
            <SliderRow 
                label="Dog Y (Right/Left)" 
                value={speeds.dogY} 
                min="0" max="5" step="0.1" 
                onChange={(val) => handleSpeedChange('dogY', val)} 
            />
            <SliderRow 
                label="Dog Z (Rotation)" 
                value={speeds.dogZ} 
                min="0" max="5" step="0.1" 
                onChange={(val) => handleSpeedChange('dogZ', val)} 
            />
            
            <div style={{ margin: '8px 0', borderBottom: '1px dotted var(--text-secondary)' }}></div>
            
            <SliderRow 
                label="Camera PTZ" 
                value={speeds.camera} 
                min="0" max="1" step="0.05" 
                onChange={(val) => handleSpeedChange('camera', val)} 
            />
        </div>
    );
}

export default SpeedSlidersWidget;
//      Component for handling the entire layout
//      Utilizes the react-grid-layout v2
// 
// for the app to render properly 
import React from 'react';
import ReactGridLayout, { useContainerWidth } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

// imports for modules
import WebRTCCamera from '../ui/WebRTCCamera';
import WasdWidget from '../widgets/WasdWidget';
import Card from '../ui/Card';
import PanTiltWidget from '../widgets/PanTiltWidget';
import ActionPanel from '../widgets/ActionPanel';
import SpeedSlidersWidget from '../widgets/SpeedSlidersWidget';
import GpsWidget from '../widgets/GpsWidget';



const Dashboard = () => {
  const { width, containerRef, mounted } = useContainerWidth();

  // layout definitions
  const layout = [
    { i: 'main_camera', x: 0, y: 0, w: 6, h: 10 },
    { i: 'ir_camera', x: 8, y: 0, w: 6, h: 10 },
    { i: 'movement', x: 0, y: 10, w: 2, h: 6 },
    { i: 'camera_controls', x: 2, y: 10, w: 2, h: 6},
    { i: 'actions', x: 4, y: 10, w: 2, h: 6 },
    //{ i: 'speeds', x: 8, y: 10, w: 4, h: 8 },
    { i: 'gps', x: 6, y: 10, w: 2, h: 6},
    // { i: 'telemetry', x: 8, y: 5, w: 4, h: 5 },
  
  ];

  return (
    <div 
      className="dashboard-container" 
      ref={containerRef} 
      style={{ background: '#111', minHeight: '100vh', padding: '16px' }}
    >
            {mounted && (
        <ReactGridLayout
          width={width}
          layout={layout}
          gridConfig={{
            cols: 12,
            rowHeight: 30,
            margin: [10, 10],
          }}
          dragConfig={{
            enable: true,
            handle: '.widget-header',
          }}
          resizeConfig={{
            enable: true,
          }}
        >
          {/* Main Camera Module */}
          <div key="main_camera">
              <WebRTCCamera 
                  title="Main Camera" 
                  streamPath="video/normal_cam" 
              />
          </div>

          {/* IR Camera Module */}
          <div key="ir_camera">
              <WebRTCCamera 
                  title="IR Camera" 
                  streamPath="video/IR_cam" 
              />
          </div>
          {/* Speeds module
          <div key="speeds">
            <Card title="Speed Controls">
              <SpeedSlidersWidget />
            </Card>
          </div>  */}

           {/* GPS module */}
          <div key="gps">
            <Card title="GPS Location">
              <GpsWidget />
            </Card>
          </div> 

          {/* Camera Controls Module */}
          <div key="camera_controls">
            <Card title="Camera Controls">
                <PanTiltWidget />
            </Card>
          </div>
        
          {/* WASD Controls Module*/}
          <div key="movement">
            <Card title="Keyboard Teleop">
                <WasdWidget />
            </Card>
          </div>

          {/* Action Panel Module */}
          <div key="actions">
            <Card title="Action Panel">
              <ActionPanel />
            </Card>
          </div>

        </ReactGridLayout>
      )}
    </div>
  );
};



export default Dashboard;
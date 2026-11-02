const host = import.meta.env.FRONTEND_API_HOST || 'localhost';
const apiPort = import.meta.env.FRONTEND_API_PORT || '73000';

export const ROS_HOST = import.meta.env.FRONTEND_API_HOST || 'localhost';
export const ROS_PORT = import.meta.env.FRONTEND_ROBOT_PORT || '88089';

export const CAMERA_IP = import.meta.env.FRONTEND_CAMERA_IP || '10.103.13.1';

export const API_BASE_URL = `http://${host}:${apiPort}`;
// Might be doing something really stupid, Max to be asked after the fact xd
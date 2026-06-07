
from fastapi import APIRouter, HTTPException, status
from ..schemas import RosSubscriptionRequest
from ..services.ros_service import ros_manager

router = APIRouter(prefix="/ros", tags=["ros"])


@router.get("/status", status_code=status.HTTP_200_OK)
async def list_topics():
    return {
        "connected_to_rosbridge": ros_manager.is_connected,
        "queued_subscriptions": list(ros_manager.desired_subscriptions.keys()),
    }

@router.post("/subscribe", status_code=status.HTTP_200_OK)
async def subscribe_topic(req: RosSubscriptionRequest):
    if not req.topic.startswith("/"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Topic name must start with '/'",
        )

    success = ros_manager.subscribe(req.topic, req.message_type)
    if not success:
        return {"message": f"Already subscribed (or queued) to topic: {req.topic}"}

    connection_status = (
        "Subscribed" if ros_manager.is_connected else "Queued subscription"
    )
    return {
        "message": f"{connection_status} to topic: {req.topic} with type: {req.message_type}"
    }

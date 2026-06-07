from pydantic import BaseModel

class RosSubscriptionRequest(BaseModel):
    topic: str
    message_type: str

class MQTTSubscriptionRequest(BaseModel):
    topic: str

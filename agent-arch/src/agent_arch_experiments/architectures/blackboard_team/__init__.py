"""A3: agent team coordinated through structured shared evidence state."""

from .architecture import BlackboardTeamArchitecture
from .blackboard import Blackboard, BlackboardState

__all__ = ["Blackboard", "BlackboardState", "BlackboardTeamArchitecture"]

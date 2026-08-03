import Landing from "./lobby/Landing";
import Lobby from "./lobby/Lobby";
import BuildingScreen from "./voting/BuildingScreen";
import VotingDeck from "./voting/VotingDeck";
import Runoff from "./reveal/Runoff";
import Reveal from "./reveal/Reveal";
import EmptyResolved from "./reveal/EmptyResolved";
import { useRoom } from "./shared/RoomContext";

export default function App() {
  const { state } = useRoom();

  if (state.status !== "in-room") {
    return <Landing />;
  }

  switch (state.phase) {
    case "LOBBY":
      return <Lobby />;
    case "BUILDING":
      return <BuildingScreen />;
    case "VOTING":
      return <VotingDeck />;
    case "RUNOFF":
      return <Runoff />;
    case "MATCHED":
      return <Reveal />;
    case "RESOLVED":
      return state.result ? <Reveal /> : <EmptyResolved />;
    default:
      return <Landing />;
  }
}

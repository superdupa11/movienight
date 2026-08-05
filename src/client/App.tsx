import Landing from "./lobby/Landing";
import Lobby from "./lobby/Lobby";
import BuildingScreen from "./voting/BuildingScreen";
import VotingDeck from "./voting/VotingDeck";
import Runoff from "./reveal/Runoff";
import Reveal from "./reveal/Reveal";
import EmptyResolved from "./reveal/EmptyResolved";
import Toast from "./shared/Toast";
import { useRoom } from "./shared/RoomContext";

export default function App() {
  const { state } = useRoom();

  if (state.status !== "in-room") {
    return <Landing />;
  }

  let screen;
  switch (state.phase) {
    case "LOBBY":
      screen = <Lobby />;
      break;
    case "BUILDING":
      screen = <BuildingScreen />;
      break;
    case "VOTING":
      screen = <VotingDeck />;
      break;
    case "RUNOFF":
      screen = <Runoff />;
      break;
    case "MATCHED":
      screen = <Reveal />;
      break;
    case "RESOLVED":
      screen = state.result ? <Reveal /> : <EmptyResolved />;
      break;
    default:
      screen = <Landing />;
  }

  return (
    <>
      <Toast />
      {screen}
    </>
  );
}

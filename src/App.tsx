import { Layout } from "@/components/Layout";
import { AppProvider } from "@/context/AppContext";
import { AppEventsProvider } from "@/context/AppEventsContext";

function App() {
  return (
    // Outermost, because both of the others hear it: the shell is one of the
    // publishers — a scan finishes there and the mounted views have to hear
    // about it — and `AppProvider` keeps the Stats current off the facts on it.
    // It holds nothing that renders, so it costs a context and no re-renders.
    <AppEventsProvider>
      <AppProvider>
        <Layout />
      </AppProvider>
    </AppEventsProvider>
  );
}

export default App;

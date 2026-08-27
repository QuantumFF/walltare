import { Layout } from "@/components/Layout";
import { AppProvider } from "@/context/AppContext";
import { AppEventsProvider } from "@/context/AppEventsContext";

function App() {
  return (
    <AppProvider>
      {/* Above the shell, because the shell is one of the publishers: a scan
          finishes there and the mounted views have to hear about it. It holds
          nothing that renders, so it costs a context and no re-renders. */}
      <AppEventsProvider>
        <Layout />
      </AppEventsProvider>
    </AppProvider>
  );
}

export default App;

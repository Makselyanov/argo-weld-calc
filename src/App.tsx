import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Home from "./pages/Home";
import NewCalculation from "./pages/NewCalculation";
import History from "./pages/History";
import CalculationDetail from "./pages/CalculationDetail";
import OrderConfirmation from "./pages/OrderConfirmation";
import ForWelders from "./pages/ForWelders";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/new-calculation" element={<NewCalculation />} />
          <Route path="/history" element={<History />} />
          <Route path="/calculation/:id" element={<CalculationDetail />} />
          <Route path="/order-confirmation" element={<OrderConfirmation />} />
          <Route path="/for-welders" element={<ForWelders />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';

interface SidebarContextType {
  sidebarHovered: boolean;
  setSidebarHovered: (hovered: boolean) => void;
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined);

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [sidebarHovered, setSidebarHovered] = useState(false);

  return (
    <SidebarContext.Provider value={{ sidebarHovered, setSidebarHovered }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error('useSidebar must be used within SidebarProvider');
  }
  return context;
}
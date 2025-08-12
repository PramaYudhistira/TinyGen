import { Link, useLocation, useSearchParams } from "react-router";
import { Plus, Clock, LogOut, Settings } from "lucide-react";
import { Separator } from "~/components/ui/separator";
import { useAuth } from "~/lib/supabase-auth";
import { useSidebar } from "~/lib/sidebar-context";

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const { sidebarHovered, setSidebarHovered } = useSidebar();
  const { user, signOut } = useAuth();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  
  if (!user) {
    return <>{children}</>;
  }

  const isHomePage = location.pathname === "/";
  const isRecentPage = location.pathname === "/recent";
  const isSettingsPage = location.pathname === "/settings";
  const hasActiveChat = isHomePage && searchParams.has('chat');

  return (
    <div className="min-h-screen relative overflow-hidden bg-gradient-to-br from-black via-gray-950 to-black">
      {/* Subtle cold gradient background */}
      <div className="absolute inset-0">
        <div className="absolute -top-24 -left-24 w-[600px] h-[600px] bg-purple-600/10 rounded-full blur-[100px]" />
        <div className="absolute -bottom-24 -right-24 w-[600px] h-[600px] bg-blue-600/10 rounded-full blur-[100px]" />
        <div className="absolute top-1/3 left-1/3 w-[400px] h-[400px] bg-indigo-600/8 rounded-full blur-[80px]" />
        <div className="absolute -top-24 -right-24 w-[500px] h-[500px] bg-cyan-600/8 rounded-full blur-[100px]" />
        <div className="absolute -bottom-24 -left-24 w-[500px] h-[500px] bg-violet-600/8 rounded-full blur-[100px]" />
      </div>

      {/* Sidebar */}
      <div 
        className={`fixed left-0 top-0 h-full bg-black/50 backdrop-blur-xl border-r border-white/10 z-50 transition-all duration-300 ${
          sidebarHovered ? 'w-64' : 'w-16'
        }`}
        onMouseEnter={() => setSidebarHovered(true)}
        onMouseLeave={() => setSidebarHovered(false)}
      >
        <div className="flex flex-col h-full">
          {/* Logo/Brand */}
          <div className="flex items-center px-4 py-6 border-b border-white/10 h-20">
            <div className="w-8 h-8 flex-shrink-0">
              <img 
                src="/Codegen_logo_white.svg" 
                alt="Tinygen" 
                className="w-8 h-8 object-contain"
              />
            </div>
            <span className={`ml-3 text-white font-semibold text-lg transition-opacity duration-300 ${
              sidebarHovered ? 'opacity-100' : 'opacity-0'
            }`}>Tinygen</span>
          </div>

          {/* Navigation Items */}
          <nav className="py-4 space-y-1">
            <Link
              to="/"
              className={`w-full flex items-center px-4 py-2 transition-all duration-200 ${
                isHomePage && !hasActiveChat
                  ? 'bg-white/10 text-white' 
                  : 'text-white/60 hover:bg-white/5 hover:text-white'
              }`}
            >
              <div className="w-8 h-8 flex items-center justify-center flex-shrink-0">
                <Plus className="w-5 h-5" />
              </div>
              <span className={`ml-3 text-sm whitespace-nowrap overflow-hidden transition-all duration-300 ${
                sidebarHovered ? 'opacity-100 w-auto' : 'opacity-0 w-0'
              }`}>New Task</span>
            </Link>
            
            <Link
              to="/recent"
              className={`w-full flex items-center px-4 py-2 transition-all duration-200 ${
                isRecentPage
                  ? 'bg-white/10 text-white'
                  : 'text-white/60 hover:bg-white/5 hover:text-white'
              }`}
            >
              <div className="w-8 h-8 flex items-center justify-center flex-shrink-0">
                <Clock className="w-5 h-5" />
              </div>
              <span className={`ml-3 text-sm whitespace-nowrap overflow-hidden transition-all duration-300 ${
                sidebarHovered ? 'opacity-100 w-auto' : 'opacity-0 w-0'
              }`}>Recent Tasks</span>
            </Link>
          </nav>

          <Separator className="bg-white/10" />
          
          {/* Settings Link */}
          <div className="py-2">
            <Link
              to="/settings"
              className={`w-full flex items-center px-4 py-2 transition-all duration-200 ${
                isSettingsPage
                  ? 'bg-white/10 text-white'
                  : 'text-white/60 hover:bg-white/5 hover:text-white'
              }`}
            >
              <div className="w-8 h-8 flex items-center justify-center flex-shrink-0">
                <Settings className="w-5 h-5" />
              </div>
              <span className={`ml-3 text-sm whitespace-nowrap overflow-hidden transition-all duration-300 ${
                sidebarHovered ? 'opacity-100 w-auto' : 'opacity-0 w-0'
              }`}>Settings</span>
            </Link>
          </div>
          
          <Separator className="bg-white/10" />

          {/* User Section at Bottom */}
          <div className="mt-auto border-t border-white/10 h-20">
            <div className="flex items-center px-4 py-4">
              <div className="w-8 h-8 flex-shrink-0">
                {user.user_metadata?.avatar_url ? (
                  <img
                    src={user.user_metadata.avatar_url}
                    alt={user.user_metadata?.user_name || 'User'}
                    className="w-8 h-8 rounded-full object-cover"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-400 to-blue-400 flex items-center justify-center">
                    <span className="text-white text-sm font-medium">
                      {user.user_metadata?.user_name?.[0]?.toUpperCase() || user.email?.[0]?.toUpperCase() || 'U'}
                    </span>
                  </div>
                )}
              </div>
              <div className={`ml-3 flex-1 overflow-hidden transition-opacity duration-300 ${
                sidebarHovered ? 'opacity-100' : 'opacity-0'
              }`}>
                <p className="text-white text-sm font-medium truncate">
                  {user.user_metadata?.user_name || user.email?.split('@')[0] || 'User'}
                </p>
                <button 
                  onClick={signOut}
                  className="text-white/60 text-xs hover:text-white transition-colors flex items-center gap-1 whitespace-nowrap cursor-pointer"
                >
                  <LogOut className="w-3 h-3" />
                  Sign out
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content - Adjusted margin for sidebar */}
      <div className="ml-16 relative z-10">
        {children}
      </div>
    </div>
  );
}
import { useState, useEffect } from "react";
import { FaGithub } from "react-icons/fa";
import { useAuth } from "~/lib/supabase-auth";
import { AppLayout } from "~/components/AppLayout";
import { useSearchParams } from "react-router";

export function meta() {
  return [
    { title: "Settings - Tinygen" },
    { name: "description", content: "Tinygen Settings" },
  ];
}

export default function Settings() {
  const { user, loading } = useAuth();
  const [appInstalled, setAppInstalled] = useState(false);
  const [checkingInstallation, setCheckingInstallation] = useState(true);
  const [searchParams] = useSearchParams();
  
  useEffect(() => {
    // Check if GitHub just redirected us here after installation
    const installationId = searchParams.get('installation_id');
    const setupAction = searchParams.get('setup_action');
    
    if (installationId && setupAction === 'install') {
      // GitHub just installed the app!
      localStorage.setItem('github_app_installed', 'true');
      localStorage.setItem('github_installation_id', installationId);
      setAppInstalled(true);
      setCheckingInstallation(false);
      
      // Clean up the URL to remove the parameters
      window.history.replaceState({}, '', '/settings');
    } else {
      // Check with our backend if the app is installed
      checkGitHubAppInstallation();
    }
  }, [searchParams]);
  
  const checkGitHubAppInstallation = async () => {
    if (!user?.user_metadata?.user_name) {
      console.log('No GitHub username found');
      setCheckingInstallation(false);
      return;
    }
    
    try {
      // Call our backend to check if the app is installed
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';
      const response = await fetch(
        `${backendUrl}/check-github-app/${user.user_metadata.user_name}`,
        {
          headers: {
            'Accept': 'application/json',
          }
        }
      );
      
      if (response.ok) {
        const data = await response.json();
        console.log('GitHub App installation check:', data);
        
        setAppInstalled(data.installed);
        
        // Save to localStorage for faster subsequent checks
        if (data.installed) {
          localStorage.setItem('github_app_installed', 'true');
          if (data.installation_id) {
            localStorage.setItem('github_installation_id', data.installation_id.toString());
          }
        } else {
          localStorage.removeItem('github_app_installed');
          localStorage.removeItem('github_installation_id');
        }
      } else {
        console.error('Backend API response:', response.status, response.statusText);
        setAppInstalled(false);
      }
    } catch (error) {
      console.error('Error checking GitHub App installation:', error);
      setAppInstalled(false);
    } finally {
      setCheckingInstallation(false);
    }
  };

  // Show loading while auth is being checked
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-black via-gray-950 to-black flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mx-auto mb-4"></div>
          <div className="text-white/70">Loading...</div>
        </div>
      </div>
    );
  }
  
  // If not logged in after loading, redirect to home
  if (!user) {
    window.location.href = '/';
    return null;
  }
  
  return (
    <AppLayout>
      <div className="min-h-screen">
        {/* Header */}
        <div className="relative z-10 border-b border-white/10 bg-black/50 backdrop-blur-xl">
          <div className="max-w-6xl mx-auto px-6 py-4">
            <h1 className="text-2xl font-bold text-white">Settings</h1>
          </div>
        </div>

        {/* Content */}
        <div className="relative z-10 max-w-4xl mx-auto px-6 py-12">
        {/* GitHub App Section */}
        <div className="bg-black/30 backdrop-blur-xl border border-white/10 rounded-2xl p-8 mb-8">
          <div className="flex items-center gap-3 mb-6">
            <FaGithub className="w-8 h-8 text-white" />
            <h2 className="text-2xl font-bold text-white">GitHub App Integration</h2>
          </div>
          
          <p className="text-white/70 mb-6 leading-relaxed">
            To use Tinygen with your GitHub repositories, you need to install the Tinygen GitHub App. 
            This allows us to:
          </p>
          
          <ul className="list-disc list-inside text-white/70 space-y-2 mb-6 ml-4">
            <li>Fork repositories when you don't have write access</li>
            <li>Create and manage branches</li>
            <li>Clone repositories into sandboxes</li>
            <li>Push changes back to your repositories</li>
          </ul>

          {!appInstalled && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-5 mb-6">
              <div className="flex items-start gap-3">
                <span className="text-yellow-400 text-2xl">⚠️</span>
                <div>
                  <p className="text-yellow-200 font-semibold mb-1">GitHub App Not Installed</p>
                  <p className="text-yellow-200/70 text-sm">
                    Install the GitHub App to enable all repository features. Without it, you won't be able to work with GitHub repositories.
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-4">
            {checkingInstallation ? (
              <div className="inline-flex items-center gap-2 px-6 py-3 text-white/60">
                <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                Checking installation...
              </div>
            ) : !appInstalled ? (
              <a
                href="https://github.com/apps/tinygen-ai/installations/new"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-6 py-3 bg-white text-black rounded-xl hover:bg-gray-100 transition-all transform hover:scale-105 font-medium"
              >
                <FaGithub className="w-5 h-5" />
                Install GitHub App
              </a>
            ) : (
              <div className="inline-flex items-center gap-2 px-6 py-3 bg-green-500/20 text-green-400 border border-green-500/30 rounded-xl font-medium">
                <span className="text-xl">✓</span>
                GitHub App Installed
              </div>
            )}
            
            {appInstalled && (
              <a
                href="https://github.com/settings/installations"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-6 py-3 bg-white/10 text-white border border-white/20 rounded-xl hover:bg-white/20 transition-all font-medium"
              >
                Manage Installation
              </a>
            )}
          </div>
        </div>

        {/* Account Section */}
        <div className="bg-black/30 backdrop-blur-xl border border-white/10 rounded-2xl p-8">
          <h2 className="text-2xl font-bold text-white mb-6">Account Information</h2>
          
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              {user?.user_metadata?.avatar_url ? (
                <img
                  src={user.user_metadata.avatar_url}
                  alt={user.user_metadata?.user_name || 'User'}
                  className="w-16 h-16 rounded-full border-2 border-white/20"
                />
              ) : (
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-400 to-blue-400 flex items-center justify-center">
                  <span className="text-white text-xl font-medium">
                    {user?.user_metadata?.user_name?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || 'U'}
                  </span>
                </div>
              )}
              
              <div>
                <p className="text-white font-medium text-lg">
                  {user?.user_metadata?.user_name || 'GitHub User'}
                </p>
                <p className="text-white/60">
                  {user?.email || 'No email available'}
                </p>
              </div>
            </div>
            
            <div className="pt-4 border-t border-white/10">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-white/40 mb-1">User ID</p>
                  <p className="text-white/70 font-mono text-xs">{user?.id}</p>
                </div>
                <div>
                  <p className="text-white/40 mb-1">Provider</p>
                  <p className="text-white/70">GitHub OAuth</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    </AppLayout>
  );
}
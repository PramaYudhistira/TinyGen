import type { Route } from "./+types/home";
import { SignedIn, SignedOut, SignInButton, useUser, UserButton } from "@clerk/react-router";
import { useState } from "react";
import { Send, Plus, Clock } from "lucide-react";
import { FaGithub } from "react-icons/fa";
import { Button } from "~/components/ui/button";
import { Separator } from "~/components/ui/separator";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "TinyGen - AI Assistant" },
    { name: "description", content: "Your personal AI assistant" },
  ];
}

export default function Home() {
  const [message, setMessage] = useState("");
  const [sidebarHovered, setSidebarHovered] = useState(false);
  const { user } = useUser();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim()) {
      console.log("Sending:", message);
      setMessage("");
    }
  };

  const sidebarItems = [
    { icon: Plus, label: "New Task", active: true },
    { icon: Clock, label: "Recent Tasks", active: false },
  ];

  return (
    <div className="min-h-screen relative overflow-hidden bg-black">
      {/* Much darker background with subtle gradient hints */}
      <div className="absolute inset-0">
        <div className="absolute inset-0 bg-black" />
        <div className="absolute inset-0 bg-gradient-to-br from-purple-900/20 via-black to-blue-900/20" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(59,130,246,0.15),transparent_40%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,rgba(168,85,247,0.15),transparent_40%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(139,92,246,0.1),transparent_50%)]" />
      </div>

      <SignedIn>
        {/* Hoverable Sidebar - Fixed and doesn't push content */}
        <div 
          className="fixed left-0 top-0 h-full z-50"
          onMouseEnter={() => setSidebarHovered(true)}
          onMouseLeave={() => setSidebarHovered(false)}
        >
          <div className={`h-full bg-black/40 backdrop-blur-xl border-r border-white/10 transition-all duration-300 ease-in-out ${
            sidebarHovered ? 'w-64' : 'w-16'
          }`}>
            {/* Logo/Brand */}
            <div className="h-16 flex items-center px-4 border-b border-white/10">
              <div className="w-8 h-8 flex items-center justify-center flex-shrink-0">
                <img src="/Codegen_logo_white.svg" alt="TinyGen" className="w-8 h-8" />
              </div>
              <span className={`ml-3 text-white font-semibold whitespace-nowrap transition-opacity duration-300 ${
                sidebarHovered ? 'opacity-100 delay-100' : 'opacity-0'
              }`}>TinyGen</span>
            </div>

            {/* Navigation Items */}
            <nav className="py-4 space-y-1">
              {sidebarItems.map((item) => (
                <button
                  key={item.label}
                  className={`w-full flex items-center px-4 py-2 transition-all duration-200 cursor-pointer ${
                    item.active 
                      ? 'bg-white/10 text-white' 
                      : 'text-white/60 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <div className="w-8 h-8 flex items-center justify-center flex-shrink-0">
                    <item.icon className="w-5 h-5" />
                  </div>
                  <span className={`ml-3 text-sm whitespace-nowrap overflow-hidden transition-all duration-300 ${
                    sidebarHovered ? 'opacity-100 w-auto' : 'opacity-0 w-0'
                  }`}>{item.label}</span>
                </button>
              ))}
            </nav>

            <Separator className="bg-white/10" />

            {/* User Section at Bottom - Fixed height */}
            <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-white/10">
              <div className="flex items-center gap-3">
                <div className="flex-shrink-0">
                  <UserButton 
                    appearance={{
                      elements: {
                        avatarBox: "w-8 h-8"
                      }
                    }}
                  />
                </div>
                <div className={`flex-1 min-w-0 transition-opacity duration-300 ${
                  sidebarHovered ? 'opacity-100 delay-100' : 'opacity-0'
                }`}>
                  <p className="text-sm text-white font-medium truncate">{user?.firstName || 'User'}</p>
                  <p className="text-xs text-white/60 truncate">{user?.primaryEmailAddress?.emailAddress}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </SignedIn>

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center justify-center min-h-screen px-4">
        <SignedOut>
          {/* Welcome section for signed out users */}
          <div className="text-center mb-12 animate-fade-in">
            <div className="mb-8 flex justify-center">
              <img src="/Codegen_logo_white.svg" alt="TinyGen" className="w-20 h-20" />
            </div>
            <h1 className="text-6xl font-bold text-white mb-4 tracking-tight">
              Welcome to TinyGen
            </h1>
            <p className="text-xl text-white/60 max-w-md mx-auto">
              Your intelligent AI assistant, ready to help with anything you need
            </p>
          </div>

          {/* Auth buttons */}
          <div className="flex flex-col sm:flex-row gap-4 animate-slide-up">

            {/* Sign in with GitHub button */}
            <SignInButton mode="modal">
              <Button 
                className="group relative px-8 py-4
                cursor-pointer
                h-auto bg-white/5 backdrop-blur-md rounded-2xl border border-white/10
                hover:border-white/20 hover:bg-white/10 transition-all duration-300 hover:scale-105 text-white/80 hover:text-white font-semibold text-lg"
                variant="ghost"
                size="lg"
              >
                <FaGithub className="w-5 h-5 mr-2" />
                <span>Sign in with GitHub</span>
              </Button>
            </SignInButton>
          </div>
        </SignedOut>

        <SignedIn>
          <div>
            {/* Welcome message */}
            <div className="mb-8 text-center animate-fade-in">
              <h2 className="text-3xl font-semibold text-white/90">
                Hello, {user?.firstName || "there"}! 👋
              </h2>
              <p className="text-white/60 mt-2">How can I help you today?</p>
            </div>

            {/* Chat input */}
            <form 
              onSubmit={handleSubmit}
              className="w-full max-w-3xl animate-slide-up"
            >
              <div className="relative group">
                <input
                  type="text"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Ask me anything..."
                  className="w-full px-6 py-4 pr-14 bg-white/5 backdrop-blur-md rounded-2xl border border-white/10 text-white placeholder-white/40 focus:outline-none focus:border-white/20 focus:bg-white/10 transition-all duration-300"
                />
                <button
                  type="submit"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-3 bg-white/5 hover:bg-white/10 rounded-xl transition-all duration-200 group-focus-within:bg-white/10"
                >
                  <Send className="w-5 h-5 text-white/80 group-focus-within:text-white" />
                </button>
              </div>
            </form>

            {/* Quick actions */}
            <div className="mt-8 flex flex-wrap gap-3 justify-center animate-fade-in-delayed">
              {["Help me write code", "Explain a concept", "Generate ideas"].map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => setMessage(prompt)}
                  className="px-4 py-2 bg-white/5 backdrop-blur-sm rounded-xl border border-white/10 text-white/60 hover:bg-white/10 hover:text-white/80 hover:border-white/20 transition-all duration-200 text-sm"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        </SignedIn>
      </div>
    </div>
  );
}
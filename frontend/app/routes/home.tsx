import type { Route } from "./+types/home";
import { useState } from "react";
import { Send } from "lucide-react";
import { useNavigate } from "react-router";
import { FaGithub } from "react-icons/fa";
import { supabase } from "~/lib/supabase-simple";
import { useAuth } from "~/lib/supabase-auth";
import { AppLayout } from "~/components/AppLayout";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Tinygen - AI Assistant" },
    { name: "description", content: "Your personal AI assistant" },
  ];
}

export default function Home() {
  const [message, setMessage] = useState("");
  const [githubUrl, setGithubUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { user, signInWithGitHub, loading } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || !user) return;

    setIsLoading(true);
    try {
      // Create new chat
      const { data: chat, error: chatError } = await supabase
        .from('chats')
        .insert({
          user_id: user.id,
          title: message.substring(0, 50) + (message.length > 50 ? '...' : ''),
          github_repo_url: githubUrl || null,
        })
        .select()
        .single();
      
      if (chatError) {
        console.error('Chat creation error:', chatError);
        throw chatError;
      }

      // Add the first message
      const { error: messageError } = await supabase
        .from('messages')
        .insert({
          chat_id: chat.id,
          content: message,
          role: 'user',
          metadata: {},
        });
      
      if (messageError) {
        console.error('Message creation error:', messageError);
        throw messageError;
      }

      // Navigate to the new chat route with the chat data
      navigate(`/chat/${chat.id}`, { 
        state: { 
          initialChat: chat,
          initialMessage: message 
        } 
      });
    } catch (error) {
      console.error('Error creating chat:', error);
    } finally {
      setIsLoading(false);
    }
  };

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

  return (
    <AppLayout>
      <div className="relative z-10 min-h-screen flex items-center justify-center px-4">
        {/* Not signed in */}
        {!user ? (
          <>
            {/* Logo for sign-in page */}
            <div className="absolute top-8 left-8 z-50">
              <img 
                src="/Codegen_logo_white.svg" 
                alt="Tinygen Logo" 
                className="h-10 md:h-12 w-auto"
              />
            </div>
            <div className="text-center max-w-2xl mx-auto">
              <h1 className="text-4xl md:text-6xl font-bold text-white mb-4 bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                Welcome to Tinygen
              </h1>
              <p className="text-white/70 mb-8 text-lg md:text-xl">Your AI-powered coding assistant</p>
              <button
                onClick={signInWithGitHub}
                className="group relative bg-gradient-to-r from-blue-600/20 to-purple-600/20 hover:from-blue-600/30 hover:to-purple-600/30 text-white border border-white/20 backdrop-blur-sm px-8 py-4 rounded-xl transition-all duration-300 cursor-pointer hover:scale-105 hover:border-white/40 flex items-center gap-3 mx-auto font-medium"
              >
                <FaGithub className="w-6 h-6 group-hover:rotate-12 transition-transform duration-300" />
                Sign in with GitHub
              </button>
            </div>
          </>
        ) : (
          // Welcome interface for signed-in users
          <div className="w-full max-w-md text-center">
            {/* Welcome message */}
            <div className="mb-8 animate-fade-in">
              <h2 className="text-3xl font-semibold text-white/90">
                Hello, {user.user_metadata?.user_name || user.email?.split('@')[0] || "there"}! 👋
              </h2>
              <p className="text-white/60 mt-2">How can I help you today?</p>
            </div>

            {/* GitHub URL input */}
            <div className="mb-6 animate-fade-in">
              <div className="relative group">
                <FaGithub className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40 z-10" />
                <input
                  type="url"
                  value={githubUrl}
                  onChange={(e) => setGithubUrl(e.target.value)}
                  placeholder="Paste your GitHub repository URL (optional)"
                  className="w-full pl-12 pr-6 py-3 bg-white/5 backdrop-blur-md rounded-xl border border-white/10 text-white placeholder-white/40 focus:outline-none focus:border-white/20 focus:bg-white/10 transition-all duration-300"
                />
              </div>
              <p className="text-xs text-white/40 mt-2 ml-1">
                I'll work with your repository to make changes and create pull requests
              </p>
            </div>

            {/* Chat input */}
            <form onSubmit={handleSubmit} className="animate-slide-up">
              <div className="relative group">
                <input
                  type="text"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Ask me anything..."
                  disabled={isLoading}
                  className="w-full px-4 py-3 pr-12 bg-white/5 backdrop-blur-md rounded-xl border border-white/10 text-white placeholder-white/40 focus:outline-none focus:border-white/20 focus:bg-white/10 transition-all duration-300 disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={isLoading || !message.trim()}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-white/5 hover:bg-white/10 rounded-lg transition-all duration-200 group-focus-within:bg-white/10 disabled:opacity-50 cursor-pointer"
                >
                  <Send className="w-5 h-5 text-white/80 group-focus-within:text-white" />
                </button>
              </div>
            </form>

            {/* Quick actions */}
            <div className="mt-6 flex flex-wrap gap-2 justify-center animate-fade-in-delayed">
              {["Help me write code", "Explain a concept", "Generate ideas"].map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => setMessage(prompt)}
                  className="px-4 py-2 bg-white/5 backdrop-blur-sm rounded-xl border border-white/10 text-white/60 hover:bg-white/10 hover:text-white/80 hover:border-white/20 transition-all duration-200 text-sm cursor-pointer"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
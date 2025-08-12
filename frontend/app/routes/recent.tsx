import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { FaGithub } from "react-icons/fa";
import { supabase, type Chat } from "~/lib/supabase-simple";
import { useAuth } from "~/lib/supabase-auth";
import { AppLayout } from "~/components/AppLayout";

export function meta() {
  return [
    { title: "Recent Tasks - Tinygen" },
    { name: "description", content: "Your recent Tinygen tasks" },
  ];
}

export default function RecentTasks() {
  const [recentChats, setRecentChats] = useState<Chat[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user) {
      loadRecentChats();
    }
  }, [user]);

  const loadRecentChats = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('chats')
        .select('*')
        .eq('user_id', user?.id)
        .order('updated_at', { ascending: false });
      
      if (error) throw error;
      setRecentChats(data || []);
    } catch (error) {
      console.error('Error loading chats:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const selectChat = (chat: Chat) => {
    // Navigate to the chat route
    navigate(`/chat/${chat.id}`);
  };

  return (
    <AppLayout>
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-4xl">
          <h2 className="text-2xl font-semibold text-white mb-6">Recent Tasks</h2>
          <div className="space-y-3">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-12">
                <div className="relative">
                  <div className="w-12 h-12 border-4 border-blue-500/20 rounded-full"></div>
                  <div className="absolute top-0 left-0 w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                </div>
                <p className="text-white/40 mt-4">Loading your tasks...</p>
              </div>
            ) : recentChats.length > 0 ? (
              recentChats.map((chat) => (
                <button
                  key={chat.id}
                  onClick={() => selectChat(chat)}
                  className="w-full text-left p-4 bg-white/5 backdrop-blur-sm rounded-xl border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-200 cursor-pointer"
                >
                  <h3 className="text-white font-medium mb-1">{chat.title}</h3>
                  {chat.github_repo_url && (
                    <div className="flex items-center gap-2 text-white/40 text-sm">
                      <FaGithub className="w-4 h-4" />
                      <span className="truncate">{chat.github_repo_url}</span>
                    </div>
                  )}
                  <p className="text-white/40 text-xs mt-2">
                    {new Date(chat.updated_at).toLocaleString()}
                  </p>
                </button>
              ))
            ) : (
              <p className="text-white/40 text-center py-8">No recent tasks yet. Start a new conversation!</p>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
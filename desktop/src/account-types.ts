export interface GitHubProfile {
  user_id: string;
  github_account_id: string;
  username: string;
  avatar_url: string;
}
export interface AccountView {
  status: "signed_out" | "waiting" | "authenticated" | "expired";
  profile: GitHubProfile | null;
  avatar_data_url: string | null;
}

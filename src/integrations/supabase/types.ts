export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      profiles: {
        Row: {
          company_size: string | null
          country: string | null
          created_at: string
          designation: string | null
          full_name: string | null
          id: string
          industry: string | null
          organization_name: string | null
          phone: string | null
          primary_currency: string | null
          time_zone: string | null
          updated_at: string
        }
        Insert: {
          company_size?: string | null
          country?: string | null
          created_at?: string
          designation?: string | null
          full_name?: string | null
          id: string
          industry?: string | null
          organization_name?: string | null
          phone?: string | null
          primary_currency?: string | null
          time_zone?: string | null
          updated_at?: string
        }
        Update: {
          company_size?: string | null
          country?: string | null
          created_at?: string
          designation?: string | null
          full_name?: string | null
          id?: string
          industry?: string | null
          organization_name?: string | null
          phone?: string | null
          primary_currency?: string | null
          time_zone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      team_invites: {
        Row: {
          created_at: string
          email: string
          id: string
          inviter_id: string
          role: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          inviter_id: string
          role?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          inviter_id?: string
          role?: string
          updated_at?: string
        }
        Relationships: []
      }
      trust_profile_attributes: {
        Row: {
          attribute_key: string
          confidence: string
          current_value: Json
          id: string
          source: string
          updated_at: string
          updated_from_change_event_id: string | null
          vendor_id: string
          verified_at: string
        }
        Insert: {
          attribute_key: string
          confidence?: string
          current_value: Json
          id?: string
          source: string
          updated_at?: string
          updated_from_change_event_id?: string | null
          vendor_id: string
          verified_at: string
        }
        Update: {
          attribute_key?: string
          confidence?: string
          current_value?: Json
          id?: string
          source?: string
          updated_at?: string
          updated_from_change_event_id?: string | null
          vendor_id?: string
          verified_at?: string
        }
        Relationships: []
      }
      vendors: {
        Row: {
          category: string | null
          company_name: string
          companies_house_number: string | null
          country: string | null
          created_at: string
          email: string | null
          id: string
          internal_owner: string | null
          internal_vendor_id: string | null
          monitoring_status: string
          owner_id: string
          risk_level: string | null
          source: string
          updated_at: string
        }
        Insert: {
          category?: string | null
          company_name: string
          companies_house_number?: string | null
          country?: string | null
          created_at?: string
          email?: string | null
          id?: string
          internal_owner?: string | null
          internal_vendor_id?: string | null
          monitoring_status?: string
          owner_id: string
          risk_level?: string | null
          source?: string
          updated_at?: string
        }
        Update: {
          category?: string | null
          company_name?: string
          companies_house_number?: string | null
          country?: string | null
          created_at?: string
          email?: string | null
          id?: string
          internal_owner?: string | null
          internal_vendor_id?: string | null
          monitoring_status?: string
          owner_id?: string
          risk_level?: string | null
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      vendor_change_events: {
        Row: {
          attribute_key: string
          dedupe_key: string
          detected_at: string
          id: string
          new_value: Json | null
          previous_value: Json | null
          severity: string
          snapshot_id: string
          source: string
          status: string
          vendor_id: string
        }
        Insert: {
          attribute_key: string
          dedupe_key: string
          detected_at?: string
          id?: string
          new_value?: Json | null
          previous_value?: Json | null
          severity: string
          snapshot_id: string
          source: string
          status?: string
          vendor_id: string
        }
        Update: {
          attribute_key?: string
          dedupe_key?: string
          detected_at?: string
          id?: string
          new_value?: Json | null
          previous_value?: Json | null
          severity?: string
          snapshot_id?: string
          source?: string
          status?: string
          vendor_id?: string
        }
        Relationships: []
      }
      vendor_company_snapshots: {
        Row: {
          accounts_next_due: string | null
          accounts_status: string | null
          checked_at: string
          company_name: string | null
          company_number: string
          company_status: string | null
          company_type: string | null
          confirmation_statement_next_due: string | null
          created_at: string
          date_of_creation: string | null
          id: string
          jurisdiction: string | null
          raw_response: Json | null
          registered_office_address: Json | null
          sic_codes: string[] | null
          source: string
          vendor_id: string
        }
        Insert: {
          accounts_next_due?: string | null
          accounts_status?: string | null
          checked_at?: string
          company_name?: string | null
          company_number: string
          company_status?: string | null
          company_type?: string | null
          confirmation_statement_next_due?: string | null
          created_at?: string
          date_of_creation?: string | null
          id?: string
          jurisdiction?: string | null
          raw_response?: Json | null
          registered_office_address?: Json | null
          sic_codes?: string[] | null
          source?: string
          vendor_id: string
        }
        Update: {
          accounts_next_due?: string | null
          accounts_status?: string | null
          checked_at?: string
          company_name?: string | null
          company_number?: string
          company_status?: string | null
          company_type?: string | null
          confirmation_statement_next_due?: string | null
          created_at?: string
          date_of_creation?: string | null
          id?: string
          jurisdiction?: string | null
          raw_response?: Json | null
          registered_office_address?: Json | null
          sic_codes?: string[] | null
          source?: string
          vendor_id?: string
        }
        Relationships: []
      }
      vendor_monitoring_alerts: {
        Row: {
          attribute_checked: string
          change_event_id: string | null
          checked_at: string
          created_at: string
          dedupe_key: string
          detected_at: string
          id: string
          new_value: string | null
          previous_value: string | null
          resolution_type: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          snapshot_id: string | null
          source: string
          status: string
          vendor_id: string
        }
        Insert: {
          attribute_checked: string
          change_event_id?: string | null
          checked_at: string
          created_at?: string
          dedupe_key: string
          detected_at?: string
          id?: string
          new_value?: string | null
          previous_value?: string | null
          resolution_type?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity: string
          snapshot_id?: string | null
          source?: string
          status?: string
          vendor_id: string
        }
        Update: {
          attribute_checked?: string
          change_event_id?: string | null
          checked_at?: string
          created_at?: string
          dedupe_key?: string
          detected_at?: string
          id?: string
          new_value?: string | null
          previous_value?: string | null
          resolution_type?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          snapshot_id?: string | null
          source?: string
          status?: string
          vendor_id?: string
        }
        Relationships: []
      }
      vendor_monitoring_config: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          last_checked_at: string | null
          next_check_at: string
          provider: string
          updated_at: string
          vendor_id: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          last_checked_at?: string | null
          next_check_at?: string
          provider: string
          updated_at?: string
          vendor_id: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          last_checked_at?: string | null
          next_check_at?: string
          provider?: string
          updated_at?: string
          vendor_id?: string
        }
        Relationships: []
      }
      vendor_monitoring_failures: {
        Row: {
          checked_at: string
          company_number: string | null
          error_type: string
          http_status: number | null
          id: string
          message: string | null
          source: string
          vendor_id: string | null
        }
        Insert: {
          checked_at?: string
          company_number?: string | null
          error_type: string
          http_status?: number | null
          id?: string
          message?: string | null
          source?: string
          vendor_id?: string | null
        }
        Update: {
          checked_at?: string
          company_number?: string | null
          error_type?: string
          http_status?: number | null
          id?: string
          message?: string | null
          source?: string
          vendor_id?: string | null
        }
        Relationships: []
      }
      vendor_monitoring_runs: {
        Row: {
          completed_at: string | null
          created_at: string
          error_message: string | null
          error_type: string | null
          id: string
          provider: string
          started_at: string
          status: string
          trigger_type: string
          vendor_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          error_type?: string | null
          id?: string
          provider: string
          started_at?: string
          status?: string
          trigger_type: string
          vendor_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          error_type?: string | null
          id?: string
          provider?: string
          started_at?: string
          status?: string
          trigger_type?: string
          vendor_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      acquire_companies_house_scheduler_lease: {
        Args: { p_lease_seconds: number; p_lease_token: string }
        Returns: boolean
      }
      release_companies_house_scheduler_lease: {
        Args: { p_lease_token: string }
        Returns: undefined
      }
      verify_vendor_monitoring_alert: {
        Args: { p_alert_id: string }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

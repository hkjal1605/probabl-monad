"use client";

import { Badge } from "@conditional-stocks/ui-kit/badge";
import { Card, CardContent } from "@conditional-stocks/ui-kit/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@conditional-stocks/ui-kit/table";
import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { useAdmin } from "@/components/providers/AdminProvider";
import { adminRequest } from "@/lib/admin-api";
import { short, time } from "@/lib/format";

interface Action {
  action: string;
  actor: string;
  createdAt: string;
  details: unknown;
  id: string;
  packetHash: string | null;
}
export function HistoryClient() {
  const admin = useAdmin();
  const query = useQuery({
    queryKey: ["admin-history"],
    queryFn: () => adminRequest<{ actions: Action[] }>(admin.token ?? "", "admin/history"),
    enabled: Boolean(admin.token),
    refetchInterval: 10_000,
  });
  const actions = query.data?.actions ?? [];
  return (
    <Card className="mt-8">
      <CardContent>
        {actions.length === 0 ? (
          <div className="flex min-h-56 flex-col items-center justify-center text-center">
            <History className="text-muted-foreground" />
            <p className="mt-4 text-sm text-muted-foreground">
              No append-only admin actions recorded.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Packet</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {actions.map((action) => (
                <TableRow key={action.id}>
                  <TableCell>{time(action.createdAt)}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{action.action.replaceAll("_", " ")}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{short(action.actor, 6)}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {action.packetHash ? short(action.packetHash, 6) : "—"}
                  </TableCell>
                  <TableCell>
                    <code className="block max-w-72 truncate text-xs">
                      {JSON.stringify(action.details)}
                    </code>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

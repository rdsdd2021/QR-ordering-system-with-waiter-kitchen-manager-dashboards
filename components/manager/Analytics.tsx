"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/lib/supabase";
import { getPerformanceMetrics } from "@/lib/api";
import { Loader2, TrendingUp, ShoppingCart, Award, Clock } from "lucide-react";

type Props = {
  restaurantId: string;
};

type DailySales = {
  total_orders: number;
  total_sales: number;
};

type TopItem = {
  item_name: string;
  total_quantity: number;
  total_revenue: number;
};

type PerformanceMetrics = {
  avgPrepSeconds: number | null;
  avgServeSeconds: number | null;
  avgTurnaroundSeconds: number | null;
  orderCount: number;
};

export default function Analytics({ restaurantId }: Props) {
  const [loading, setLoading] = useState(true);
  const [todaySales, setTodaySales] = useState<DailySales | null>(null);
  const [topItems, setTopItems] = useState<TopItem[]>([]);
  const [performanceMetrics, setPerformanceMetrics] = useState<PerformanceMetrics | null>(null);

  useEffect(() => {
    loadAnalytics();
  }, [restaurantId]);

  async function loadAnalytics() {
    setLoading(true);

    try {
      // Get today's sales
      const today = new Date().toISOString().split("T")[0];
      const { data: salesData } = await supabase
        .from("daily_sales")
        .select("total_orders, total_sales")
        .eq("restaurant_id", restaurantId)
        .eq("sale_date", today)
        .maybeSingle();

      setTodaySales(salesData || { total_orders: 0, total_sales: 0 });

      // Get top 5 selling items
      const { data: topItemsData } = await supabase
        .from("top_selling_items")
        .select("item_name, total_quantity, total_revenue")
        .eq("restaurant_id", restaurantId)
        .order("total_quantity", { ascending: false })
        .limit(5);

      setTopItems(topItemsData || []);

      // Get performance metrics
      const metrics = await getPerformanceMetrics(restaurantId);
      setPerformanceMetrics(metrics);
    } catch (err) {
      console.error("Error loading analytics:", err);
    } finally {
      setLoading(false);
    }
  }

  function formatTime(seconds: number | null): string {
    if (seconds === null) return 'N/A';
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes}m ${secs}s`;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Analytics</h2>
        <p className="text-sm text-muted-foreground">
          Sales and performance metrics
        </p>
      </div>

      {/* Today's Stats */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Sales Today</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ₹{(todaySales?.total_sales || 0).toFixed(2)}
            </div>
            <p className="text-xs text-muted-foreground">
              From {todaySales?.total_orders || 0} orders
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Orders Today</CardTitle>
            <ShoppingCart className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{todaySales?.total_orders || 0}</div>
            <p className="text-xs text-muted-foreground">
              Completed and billed
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Top Selling Items */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Award className="h-5 w-5 text-muted-foreground" />
            <CardTitle>Top Selling Items</CardTitle>
          </div>
          <CardDescription>
            Best performing menu items (all time)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {topItems.length === 0 ? (
            <div className="flex h-24 items-center justify-center rounded-md border border-dashed">
              <p className="text-sm text-muted-foreground">No sales data yet</p>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Quantity Sold</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topItems.map((item, index) => (
                    <TableRow key={index}>
                      <TableCell className="font-medium">{item.item_name}</TableCell>
                      <TableCell className="text-right">{item.total_quantity}</TableCell>
                      <TableCell className="text-right font-semibold">
                        ₹{item.total_revenue.toFixed(2)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Performance Metrics */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-muted-foreground" />
            <CardTitle>Performance Metrics</CardTitle>
          </div>
          <CardDescription>
            Average time metrics for completed orders
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!performanceMetrics || performanceMetrics.orderCount === 0 ? (
            <div className="flex h-24 items-center justify-center rounded-md border border-dashed">
              <p className="text-sm text-muted-foreground">
                No completed orders yet. Metrics will appear after orders are processed.
              </p>
            </div>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-lg border p-4">
                  <p className="text-sm font-medium text-muted-foreground">Avg Preparation Time</p>
                  <p className={`text-2xl font-bold mt-2 ${performanceMetrics.avgPrepSeconds === null ? 'text-muted-foreground text-base' : ''}`}>
                    {formatTime(performanceMetrics.avgPrepSeconds)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">Confirmed → Ready</p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-sm font-medium text-muted-foreground">Avg Serving Time</p>
                  <p className={`text-2xl font-bold mt-2 ${performanceMetrics.avgServeSeconds === null ? 'text-muted-foreground text-base' : ''}`}>
                    {formatTime(performanceMetrics.avgServeSeconds)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">Ready → Served</p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-sm font-medium text-muted-foreground">Avg Turnaround Time</p>
                  <p className={`text-2xl font-bold mt-2 ${performanceMetrics.avgTurnaroundSeconds === null ? 'text-muted-foreground text-base' : ''}`}>
                    {formatTime(performanceMetrics.avgTurnaroundSeconds)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">Created → Served</p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground mt-4">
                Based on {performanceMetrics.orderCount} completed order{performanceMetrics.orderCount !== 1 ? 's' : ''}
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

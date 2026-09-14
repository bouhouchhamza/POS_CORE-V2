<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Product;
use App\Models\Sale;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DashboardController extends Controller
{
    public function __invoke(Request $request): JsonResponse
    {
        abort_if($request->user()?->role !== 'patron', 403, 'Only patron users can access dashboard.');

        $todayStart = now()->startOfDay();
        $todayEnd = now()->endOfDay();

        $todaySales = (float) Sale::whereBetween('created_at', [$todayStart, $todayEnd])->sum('total');
        $todayTickets = Sale::whereBetween('created_at', [$todayStart, $todayEnd])->count();

        $lowStockProducts = Product::query()
            ->with('category:id,name')
            ->whereColumn('stock', '<=', 'min_stock')
            ->select(['id', 'name', 'stock', 'min_stock', 'category_id'])
            ->orderBy('stock')
            ->get()
            ->map(fn (Product $product): array => [
                'id' => $product->id,
                'name' => $product->name,
                'stock_quantity' => $product->stock,
                'min_stock' => $product->min_stock,
                'category_name' => $product->category?->name,
            ])
            ->values();

        return response()->json([
            'today_sales' => $todaySales,
            'today_tickets' => $todayTickets,
            'low_stock_count' => $lowStockProducts->count(),
            'low_stock_products' => $lowStockProducts,
        ]);
    }
}

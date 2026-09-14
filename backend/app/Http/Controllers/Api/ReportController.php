<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\SaleResource;
use App\Models\Sale;
use App\Models\SaleItem;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ReportController extends Controller
{
    /**
     * Today's sales report.
     *
     * - Patron can filter by worker: ?worker_id=ID
     * - Worker gets 403 (Sales page is patron-only now).
     */
    public function today(Request $request): JsonResponse
    {
        $this->authorizePatron($request);

        $validated = $request->validate([
            'worker_id' => ['nullable', 'integer', 'exists:users,id'],
        ]);

        $start = now()->startOfDay();
        $end = now()->endOfDay();

        $workerId = $validated['worker_id'] ?? null;
        $workerName = null;

        if ($workerId) {
            $workerName = User::where('id', $workerId)->value('name');
        }

        return $this->reportResponse($start, $end, [
            'type' => 'today',
            'date' => now()->toDateString(),
            'start' => $start->toISOString(),
            'end' => $end->toISOString(),
            'worker_id' => $workerId ? (int) $workerId : null,
            'worker_name' => $workerName,
        ], $workerId ? (int) $workerId : null);
    }

    /**
     * Monthly sales report (patron only, unchanged).
     */
    public function monthly(Request $request): JsonResponse
    {
        $this->authorizePatron($request);

        $validated = $request->validate([
            'month' => ['nullable', 'date_format:Y-m'],
        ]);

        $month = Carbon::createFromFormat('Y-m', $validated['month'] ?? now()->format('Y-m'));
        $start = $month->copy()->startOfMonth();
        $end = $month->copy()->endOfMonth();

        return $this->reportResponse($start, $end, [
            'type' => 'monthly',
            'month' => $month->format('Y-m'),
            'start' => $start->toISOString(),
            'end' => $end->toISOString(),
        ]);
    }

    /**
     * List workers for the patron's worker filter dropdown.
     */
    public function workers(Request $request): JsonResponse
    {
        $this->authorizePatron($request);

        $workers = User::query()
            ->where('role', 'worker')
            ->select(['id', 'name', 'email'])
            ->orderBy('name')
            ->get();

        return response()->json($workers);
    }

    private function authorizePatron(Request $request): void
    {
        abort_if($request->user()?->role !== 'patron', 403, 'Only patron users can access reports.');
    }

    /**
     * @param  array<string, mixed>  $period
     */
    private function reportResponse(Carbon $start, Carbon $end, array $period, ?int $workerId = null): JsonResponse
    {
        $salesQuery = Sale::query()
            ->with(['user', 'items.product.category'])
            ->whereBetween('created_at', [$start, $end]);

        if ($workerId) {
            $salesQuery->where('user_id', $workerId);
        }

        $sales = $salesQuery->latest()->get();

        $bestProductsQuery = SaleItem::query()
            ->with('product')
            ->whereHas('sale', function ($query) use ($start, $end, $workerId): void {
                $query->whereBetween('created_at', [$start, $end]);
                if ($workerId) {
                    $query->where('user_id', $workerId);
                }
            })
            ->select('product_id')
            ->selectRaw('SUM(quantity) as quantity')
            ->selectRaw('SUM(total) as total')
            ->groupBy('product_id')
            ->orderByDesc('quantity');

        $bestProducts = $bestProductsQuery
            ->get()
            ->map(fn (SaleItem $item): array => [
                'product_id' => $item->product_id,
                'name' => $item->product?->name ?? 'Produit #'.$item->product_id,
                'quantity' => (int) $item->quantity,
                'total' => (float) $item->total,
            ])
            ->values();

        return response()->json([
            'period' => $period,
            'total_sales' => (float) $sales->sum('total'),
            'total_orders' => $sales->count(),
            'total_products_sold' => (int) $sales->flatMap->items->sum('quantity'),
            'best_products' => $bestProducts,
            'commandes' => SaleResource::collection($sales),
        ]);
    }
}

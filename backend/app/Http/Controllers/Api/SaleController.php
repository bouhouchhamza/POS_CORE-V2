<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\SaleResource;
use App\Models\Product;
use App\Models\Sale;
use App\Models\StockMovement;
use App\Services\TicketPrinterService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use RuntimeException;

class SaleController extends Controller
{
    public function index()
    {
        return SaleResource::collection(
            Sale::query()
                ->with(['user', 'items.product.category'])
                ->latest()
                ->get()
        );
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'payment_method' => ['nullable', 'string', 'max:50'],
            'note' => ['nullable', 'string'],
            'items' => ['required', 'array', 'min:1'],
            'items.*.product_id' => ['required', 'integer', 'exists:products,id'],
            'items.*.quantity' => ['required', 'integer', 'min:1'],
        ]);

        $sale = DB::transaction(function () use ($request, $validated): Sale {
            $requestedItems = collect($validated['items'])
                ->groupBy('product_id')
                ->map(fn ($items): int => (int) $items->sum('quantity'));

            $products = Product::query()
                ->whereIn('id', $requestedItems->keys())
                ->orderBy('id')
                ->lockForUpdate()
                ->get()
                ->keyBy('id');

            $sale = Sale::create([
                'user_id' => $request->user()->id,
                'payment_method' => $validated['payment_method'] ?? 'cash',
                'note' => $validated['note'] ?? null,
                'total' => 0,
                'profit' => 0,
            ]);

            $saleTotal = 0;
            $saleProfit = 0;

            foreach ($requestedItems as $productId => $quantity) {
                $product = $products->get($productId);

                if (! $product) {
                    throw ValidationException::withMessages([
                        'items' => ["Product {$productId} was not found."],
                    ]);
                }

                if ($product->stock < $quantity) {
                    throw ValidationException::withMessages([
                        'items' => ["Insufficient stock for {$product->name}. Available stock: {$product->stock}."],
                    ]);
                }

                $beforeStock = $product->stock;
                $afterStock = $beforeStock - $quantity;
                $unitPrice = (float) $product->sale_price;
                $purchasePrice = 0.0;
                $itemTotal = round($unitPrice * $quantity, 2);
                $itemProfit = round(($unitPrice - $purchasePrice) * $quantity, 2);

                $sale->items()->create([
                    'product_id' => $product->id,
                    'quantity' => $quantity,
                    'unit_price' => $unitPrice,
                    'purchase_price' => $purchasePrice,
                    'total' => $itemTotal,
                    'profit' => $itemProfit,
                ]);

                $product->update(['stock' => $afterStock]);

                StockMovement::create([
                    'product_id' => $product->id,
                    'user_id' => $request->user()->id,
                    'type' => 'sale',
                    'quantity' => $quantity,
                    'before_stock' => $beforeStock,
                    'after_stock' => $afterStock,
                    'note' => 'Sale #'.$sale->id,
                ]);

                $saleTotal += $itemTotal;
                $saleProfit += $itemProfit;
            }

            $sale->update([
                'total' => round($saleTotal, 2),
                'profit' => round($saleProfit, 2),
            ]);

            return $sale->load(['user', 'items.product.category']);
        });

        return (new SaleResource($sale))
            ->response()
            ->setStatusCode(201);
    }

    public function show(Sale $sale): SaleResource
    {
        return new SaleResource($sale->load(['user', 'items.product.category']));
    }

    public function printTicket(Request $request, Sale $sale, TicketPrinterService $printer): JsonResponse
    {
        $validated = $request->validate([
            'copies' => ['nullable', 'integer', 'min:1', 'max:2'],
        ]);

        try {
            $result = $printer->printSale(
                $sale->load(['user', 'items.product.category']),
                (int) ($validated['copies'] ?? 2),
            );
        } catch (RuntimeException $exception) {
            return response()->json([
                'message' => $exception->getMessage(),
            ], 422);
        }

        return response()->json($result);
    }
}

import React, { useState } from "react";
import * as XLSX from "xlsx";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Upload, Download, SortAsc, SortDesc, Filter } from "lucide-react";

const DesaTaggingDashboard = () => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [sortOrder, setSortOrder] = useState("desc"); // 'asc' or 'desc'
  const [filterText, setFilterText] = useState("");
  const [originalData, setOriginalData] = useState([]);

  // Proses upload file Excel
  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setLoading(true);
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const workbook = XLSX.read(e.target.result, { type: "binary" });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);

        // Proses data untuk mendapatkan jumlah tagging per desa
        const desaCount = {};

        jsonData.forEach((row) => {
          const desa = row.Desa?.toString().trim();
          if (desa && desa !== "") {
            desaCount[desa] = (desaCount[desa] || 0) + 1;
          }
        });

        // Konversi ke array dan urutkan
        const processedData = Object.entries(desaCount).map(
          ([desa, count]) => ({
            desa,
            count,
            percentage: ((count / jsonData.length) * 100).toFixed(2),
          })
        );

        setOriginalData(processedData);
        sortData(processedData, "desc");
        setLoading(false);
      } catch (error) {
        console.error("Error processing file:", error);
        alert("Error memproses file. Pastikan format file Excel benar.");
        setLoading(false);
      }
    };

    reader.readAsBinaryString(file);
  };

  // Fungsi sorting data
  const sortData = (dataToSort, order) => {
    const sorted = [...dataToSort].sort((a, b) => {
      if (order === "desc") {
        return b.count - a.count;
      } else {
        return a.count - b.count;
      }
    });
    setData(sorted);
  };

  // Handle perubahan sorting
  const handleSortChange = (newOrder) => {
    setSortOrder(newOrder);
    sortData(originalData, newOrder);
  };

  // Filter data berdasarkan nama desa
  const filteredData = data.filter((item) =>
    item.desa.toLowerCase().includes(filterText.toLowerCase())
  );

  // Export data ke Excel
  const exportToExcel = () => {
    // Buat salinan data yang difilter dan urutkan berdasarkan count tertinggi
    const dataForExport = [...filteredData].sort((a, b) => b.count - a.count);

    const exportData = dataForExport.map((item, index) => ({
      Ranking: index + 1,
      "Nama Desa": item.desa,
      "Jumlah Tagging": item.count,
      "Persentase (%)": item.percentage,
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Data Tagging per Desa");
    XLSX.writeFile(wb, "sebaran_tagging_desa.xlsx");
  };

  // Komponen Progress Bar
  const ProgressBar = ({ value, max, label, count }) => {
    const percentage = (value / max) * 100;
    return (
      <div className="p-4 mb-4 bg-white border border-gray-200 rounded-lg shadow">
        <div className="flex items-center justify-between mb-2">
          <span className="mr-2 text-sm font-medium text-gray-700 truncate">
            {label}
          </span>
          <div className="flex items-center space-x-2">
            <span className="text-sm font-bold text-blue-600">
              {count.toLocaleString()}
            </span>
            <span className="text-xs text-gray-500">
              (
              {(
                (value /
                  originalData.reduce((sum, item) => sum + item.count, 0)) *
                100
              ).toFixed(1)}
              %)
            </span>
          </div>
        </div>
        <div className="w-full h-3 bg-gray-200 rounded-full">
          <div
            className="h-3 transition-all duration-300 ease-out rounded-full bg-gradient-to-r from-blue-500 to-blue-600"
            style={{ width: `${percentage}%` }}
          ></div>
        </div>
      </div>
    );
  };

  const maxCount =
    data.length > 0 ? Math.max(...data.map((item) => item.count)) : 0;
  const totalData = originalData.reduce((sum, item) => sum + item.count, 0);

  return (
    <div className="min-h-screen p-6 bg-gray-50">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-6">
          <div className="relative overflow-hidden rounded-lg">
            <div className="absolute inset-0 bg-gradient-to-r from-indigo-600 via-sky-600 to-emerald-500 opacity-95"></div>
            <div className="relative p-8 text-white sm:p-12">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-3">
                  <img
                    src="/logo-bps-nganjuk-transparan.png"
                    alt="logo BPS Nganjuk"
                    className="w-10 h-10 p-1 rounded-md bg-white/20"
                  />
                  <div>
                    <div className="text-sm font-semibold tracking-wider uppercase">
                      BPS Kabupaten Nganjuk
                    </div>
                    <div className="text-xs opacity-80">Dashboard Resmi</div>
                  </div>
                </div>
                <div className="px-3 py-1 text-sm rounded-full bg-white/20">
                  {new Date().toLocaleDateString()}
                </div>
              </div>

              <h1 className="text-4xl font-extrabold leading-tight sm:text-5xl">
                Dashboard Sebaran Data Tagging per Desa
              </h1>
              <p className="max-w-2xl mt-3 text-lg opacity-90">
                Analisis distribusi data tagging dari{" "}
                <span className="font-semibold">
                  {totalData.toLocaleString()}
                </span>{" "}
                total entri
              </p>

              <div className="flex mt-6 space-x-3">
                <label className="flex items-center px-4 py-2 space-x-2 text-indigo-700 transition bg-white rounded-lg cursor-pointer hover:brightness-90">
                  <Upload size={16} />
                  <span className="font-medium">Pilih File Excel (.xlsx/.csv)</span>
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
                {data.length > 0 && (
                  <button
                    onClick={exportToExcel}
                    className="flex items-center px-4 py-2 space-x-2 text-white transition border rounded-lg bg-white/20 border-white/30 hover:bg-white/10"
                  >
                    <Download size={16} />
                    <span>Export Excel</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Upload Section */}
        <div className="p-6 mb-6 bg-white border border-gray-200 rounded-lg shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-800">
              Upload Data Excel
            </h2>
            {data.length > 0 && (
              <button
                onClick={exportToExcel}
                className="flex items-center px-4 py-2 space-x-2 text-white transition-colors bg-green-600 rounded-lg hover:bg-green-700"
              >
                <Download size={16} />
                <span>Export Excel</span>
              </button>
            )}
          </div>

          <div className="flex items-center space-x-4">
            <label className="flex items-center px-4 py-2 space-x-2 text-white transition-colors bg-blue-600 rounded-lg cursor-pointer hover:bg-blue-700">
              <Upload size={16} />
              <span>Pilih File Excel (.xlsx/.csv)</span>
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>
            {loading && (
              <div className="flex items-center space-x-2">
                <div className="w-5 h-5 border-b-2 border-blue-600 rounded-full animate-spin"></div>
                <span className="text-gray-600">Memproses data...</span>
              </div>
            )}
          </div>
        </div>

        {data.length > 0 && (
          <>
            {/* Controls */}
            <div className="p-6 mb-6 bg-white border border-gray-200 rounded-lg shadow-sm">
              <div className="flex flex-col space-y-4 md:flex-row md:items-center md:justify-between md:space-y-0">
                <div className="flex items-center space-x-4">
                  <button
                    onClick={() =>
                      handleSortChange(sortOrder === "desc" ? "asc" : "desc")
                    }
                    className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-colors ${
                      sortOrder === "desc"
                        ? "bg-blue-600 text-white hover:bg-blue-700"
                        : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                    }`}
                  >
                    {sortOrder === "desc" ? (
                      <SortDesc size={16} />
                    ) : (
                      <SortAsc size={16} />
                    )}
                    <span>
                      {sortOrder === "desc"
                        ? "Terbanyak → Tersedikit"
                        : "Tersedikit → Terbanyak"}
                    </span>
                  </button>
                </div>

                <div className="flex items-center space-x-2">
                  <Filter size={16} className="text-gray-500" />
                  <input
                    type="text"
                    placeholder="Filter nama desa..."
                    value={filterText}
                    onChange={(e) => setFilterText(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>
            </div>

            {/* Summary Stats */}
            <div className="grid grid-cols-1 gap-6 mb-6 md:grid-cols-4">
              <div className="p-6 bg-white border border-gray-200 rounded-lg shadow-sm">
                <h3 className="text-sm font-medium tracking-wide text-gray-500 uppercase">
                  Total Desa
                </h3>
                <p className="text-2xl font-bold text-blue-600">
                  {data.length}
                </p>
              </div>
              <div className="p-6 bg-white border border-gray-200 rounded-lg shadow-sm">
                <h3 className="text-sm font-medium tracking-wide text-gray-500 uppercase">
                  Total Entri
                </h3>
                <p className="text-2xl font-bold text-green-600">
                  {totalData.toLocaleString()}
                </p>
              </div>
              <div className="p-6 bg-white border border-gray-200 rounded-lg shadow-sm">
                <h3 className="text-sm font-medium tracking-wide text-gray-500 uppercase">
                  Rata-rata per Desa
                </h3>
                <p className="text-2xl font-bold text-purple-600">
                  {Math.round(totalData / data.length)}
                </p>
              </div>
              <div className="p-6 bg-white border border-gray-200 rounded-lg shadow-sm">
                <h3 className="text-sm font-medium tracking-wide text-gray-500 uppercase">
                  Tertinggi
                </h3>
                <p className="text-2xl font-bold text-red-600">
                  {maxCount.toLocaleString()}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {/* Progress Bars */}
              <div className="p-6 bg-white border border-gray-200 rounded-lg shadow-sm">
                <h2 className="mb-4 text-xl font-semibold text-gray-800">
                  Progress per Desa ({filteredData.length} dari {data.length}{" "}
                  desa)
                </h2>
                <div className="overflow-y-auto max-h-96">
                  {filteredData.map((item, index) => (
                    <ProgressBar
                      key={item.desa}
                      value={item.count}
                      max={maxCount}
                      label={`${index + 1}. ${item.desa}`}
                      count={item.count}
                    />
                  ))}
                </div>
              </div>

              {/* Chart */}
              <div className="p-6 bg-white border border-gray-200 rounded-lg shadow-sm">
                <h2 className="mb-4 text-xl font-semibold text-gray-800">
                  Top 20 Desa
                </h2>
                <ResponsiveContainer width="100%" height={400}>
                  <BarChart
                    data={filteredData.slice(0, 20)}
                    margin={{ top: 20, right: 30, left: 20, bottom: 60 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="desa"
                      angle={-45}
                      textAnchor="end"
                      height={80}
                      fontSize={10}
                    />
                    <YAxis />
                    <Tooltip
                      formatter={(value, name) => [
                        `${value.toLocaleString()} entri`,
                        "Jumlah Tagging",
                      ]}
                      labelStyle={{ color: "#374151" }}
                    />
                    <Bar dataKey="count" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </>
        )}

        {data.length === 0 && !loading && (
          <div className="p-12 text-center bg-white border border-gray-200 rounded-lg shadow-sm">
            <Upload size={48} className="mx-auto mb-4 text-gray-400" />
            <h3 className="mb-2 text-lg font-medium text-gray-900">
              Belum ada data yang dimuat
            </h3>
            <p className="text-gray-600">
              Upload file Excel Anda untuk melihat dashboard sebaran data
              tagging per desa
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default DesaTaggingDashboard;
